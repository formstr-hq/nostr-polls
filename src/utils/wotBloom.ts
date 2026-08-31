// Bloom filter for crossing the web-of-trust set to the Android background
// worker. At 2nd-degree scale the WoT union reaches 100k–300k+ pubkeys; a JSON
// array in SharedPreferences (~6.5 bytes/pubkey) would balloon to multiple MB
// and be re-parsed on every worker run. A bloom filter is ~2KB per 1k entries
// and chunked base64 keeps the Preferences blob manageable.
//
// The math must match NotificationWorker.java EXACTLY (tests cover the other
// side of the wire format). Spec, frozenwire format v1:
//   k = 11 double hashes, m = bits (power of two), big-endian u32 slices of the
//   RAW pubkey bytes: h1 = bytes[0..4], h2 = bytes[4..8], idx_i = (h1 + i*h2) mod m.
// No cryptographic hash — both sides read the same 64 bits off the raw hex so
// there is no library-parity risk.

export const WOT_BLOOM_BITS_PER_ENTRY = 16;
export const WOT_BLOOM_K = 11;

export interface WotBloom {
  /** Bit count m (power of two). */
  bits: number;
  /** Base64 of the packed bit array, big-endian byte order. */
  data: string;
}

/** Big-endian u32 at rawBytes[off]. Returns 0 on short reads (hex-decode has
 * already guaranteed byte length; this guards hypothetical short keys). */
function u32be(bytes: Uint8Array, off: number): number {
  if (off + 4 > bytes.length) return 0;
  // >>> 0 to get an unsigned 32-bit value.
  return (
    ((bytes[off] << 24) |
      (bytes[off + 1] << 16) |
      (bytes[off + 2] << 8) |
      bytes[off + 3]) >>>
    0
  );
}

/** MurmurHash3 32-bit finalizer. Must match Java-side fmix32 exactly. */
function fmix32(h: number): number {
  let x = h >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * Build the bridge filter from a set of pubkeys. Returns null for empty/no
 * input (caller bridges "gate not enforcable" state instead).
 */
export function buildWotBloom(pubkeys: Iterable<string>): WotBloom | null {
  const list = Array.from(pubkeys).filter((pk) => typeof pk === "string" && pk.length > 0);
  if (list.length === 0) return null;

  // Round m up to a whole number of bytes. No power-of-two requirement — both
  // sides use true modulo (idx % m), unlike mask-based bloom implementations.
  const targetBits = list.length * WOT_BLOOM_BITS_PER_ENTRY;
  const m = Math.max(1024, Math.ceil(targetBits / 8) * 8);

  const bytes = new Uint8Array(m >>> 3); // m / 8
  const scratch = new Uint8Array(32);

  for (const pk of list) {
    let valid = true;
    let h1 = 0;
    let h2 = 0;
    try {
      for (let i = 0; i < 32; i++) {
        const byte = parseInt(pk.substr(i * 2, 2), 16);
        if (Number.isNaN(byte)) {
          valid = false;
          break;
        }
        scratch[i] = byte;
      }
      if (!valid || pk.length !== 64) {
        // Non-hex/partial keys silently excluded: the JS-side exact-check gate
        // never consults the bloom, so a missed entry here is only a missed
        // filter optimization, not a correctness break.
        continue;
      }
      h1 = u32be(scratch, 0);
      h2 = u32be(scratch, 4);
      // h1/h2 are adjacent slices of the same key — weakly correlated, which
      // measurably inflates the FP rate (~4× in testing). Run each through the
      // MurmurHash3 32-bit finalizer to decorrelate. |1 keeps h2 nonzero so a
      // key like 00000000_00000001… can't collapse all k probes to one bit.
      h1 = fmix32(h1);
      // |1 keeps h2 nonzero (a key can't collapse all k probes to one bit);
      // >>> 0 restores unsigned semantics — Java side hashes into an unsigned
      // long, and values congruent mod 2^32 are NOT congruent mod m.
      h2 = (fmix32(h2) | 1) >>> 0;
    } catch {
      continue;
    }
    for (let i = 0; i < WOT_BLOOM_K; i++) {
      // JS % keeps the dividend's sign: i*h2 exceeds 2^31 for large h2, making
      // the raw sum negative. Normalize like Java's positive long modulo.
      const idx = ((h1 + i * h2) % m + m) % m;
      bytes[idx >>> 3] |= 1 << (idx & 7);
    }
    // h2 === 0 collapses all k probes to the same bit — harmless (still a
    // valid single-bit membership) but flag it in debug if needed.
  }

  return { bits: m, data: bytesToBase64(bytes) };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary);
}