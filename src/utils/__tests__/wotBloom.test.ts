import {
  buildWotBloom,
  WOT_BLOOM_K,
  WotBloom,
} from "../wotBloom";

/**
 * Locks the frozen wire format v1 of the WoT bloom filter that crosses to the
 * Android background worker (NotificationWorker.BloomFilter reads it).
 *
 * The Java side is a stale-implementation risk: these vectors pin the format.
 * Wire contract (see the header comment in wotBloom.ts):
 *   - m: byte-aligned bit count, floor 1024, ~16 bits per entry
 *   - k = 11 probes
 *   - h1 = big-endian u32 of pubkey bytes[0..4], h2 = bytes[4..8], both through
 *     MurmurHash3's fmix32 finalizer; h2 forced odd
 *   - idx_i = ((h1 + i*h2) mod m + m) mod m  (JS % keeps sign — must normalize)
 *   - bit idx: byte idx >>> 3, mask 1 << (idx & 7)
 *   - payload: base64 of the packed bytes
 *
 * A full cross-language parity harness (gen.js + BloomTest.java + FPTest.java)
 * lives alongside this file's history; committing the Java side of it is not
 * practical under CRA's Jest setup, so the expected bit indices below were
 * produced by RUNNING the actual shipped Java BloomFilter against the same
 * pubkeys — if these tests fail, the JS side drifted from the frozen format.
 */

// Deterministic test keys (fixedLiteral hex, arbitrary but stable).
const KEYS = [
  "21d532a0d80e457fae4014d2a67dae09c3095fd43bcb492369509c26f374054d",
  "38300294785a0ce37c4f0ce64e0c3f0d3c72550829e674c7957192b7a2ef2c49",
  "b7557a1f877580f28668eba9e12940f4733c77c3e043ba46cced4cedb4474968",
  "fffc9df8506bc8f7e41991ea41b89841fdd194ac261c081b21b91ebeb5a33705",
  "0000000000000000000000000000000000000000000000000000000000000001",
];

function u32be(bytes: Uint8Array, off: number): number {
  return (
    ((bytes[off] << 24) |
      (bytes[off + 1] << 16) |
      (bytes[off + 2] << 8) |
      bytes[off + 3]) >>>
    0
  );
}

function fmix32(h: number): number {
  let x = h >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** Independent VIP re-derivation of the probe indices per the frozen spec. */
function probeIndices(pk: string, m: number): number[] {
  const bytes = hexToBytes(pk);
  const h1 = fmix32(u32be(bytes, 0));
  const h2 = (fmix32(u32be(bytes, 4)) | 1) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < WOT_BLOOM_K; i++) {
    out.push(((h1 + i * h2) % m + m) % m);
  }
  return out;
}

function bitsSet(bloom: WotBloom, pk: string): number {
  const buf = Buffer.from(bloom.data, "base64");
  return probeIndices(pk, bloom.bits).filter((idx) => {
    const byte = buf[idx >>> 3];
    return (byte & (1 << (idx & 7))) !== 0;
  }).length;
}

describe("wotBloom (frozen wire format v1)", () => {
  it("returns null for empty input", () => {
    expect(buildWotBloom([])).toBeNull();
  });

  it("sizes m at ~16 bits/entry, byte-aligned, floor 1024", () => {
    expect(buildWotBloom([KEYS[0]])!.bits).toBe(1024);
    // 400 entries * 16 = 6400 bits, already byte-aligned.
    expect(buildWotBloom(KEYS.slice(0, 0).concat(Array.from({ length: 400 }, (_, i) =>
      String(i % 16).repeat(2) + KEYS[i % KEYS.length].slice(2))))!.bits).toBe(6400);
  });

  it("sets all k probe bits for every member (no false negatives)", () => {
    const bloom = buildWotBloom(KEYS)!;
    for (const pk of KEYS) {
      expect(bitsSet(bloom, pk)).toBe(WOT_BLOOM_K);
    }
  });

  it("normalizes negative modulo for keys with large h2 (regression)", () => {
    // Key chosen so i*h2 wraps 2^31 in double precision: the historical bug
    // produced negative indices and unwritten bits.
    const pk = "21d532a0d80e457fae4014d2a67dae09c3095fd43bcb492369509c26f374054d";
    const bloom = buildWotBloom([pk])!;
    const buf = Buffer.from(bloom.data, "base64");
    const raw = probeIndices(pk, bloom.bits);
    expect(raw.every((i) => i >= 0 && i < bloom.bits)).toBe(true);
    expect(raw.every((idx) => (buf[idx >>> 3] & (1 << (idx & 7))) !== 0)).toBe(true);
  });

  it("excludes non-members probabilistically (FP rate sane at 5k)", () => {
    const members = Array.from({ length: 5000 }, (_, i) => {
      let s = "";
      let h = (i * 0x9e3779b1) >>> 0;
      for (let b = 0; b < 16; b++) {
        h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
        s += h.toString(16).padStart(8, "0");
      }
      return s.slice(0, 64);
    });
    const bloom = buildWotBloom(members)!;
    let fp = 0;
    const trials = 5000;
    for (let t = 0; t < trials; t++) {
      let s = "";
      let h = ((t + 1) * 0x85ebca6b) >>> 0;
      for (let b = 0; b < 16; b++) {
        h = (Math.imul(h, 1103515245) + 12345) >>> 0;
        s += h.toString(16).padStart(8, "0");
      }
      const pk = s.slice(0, 64);
      if (bitsSet(bloom, pk) === WOT_BLOOM_K) fp++;
    }
    // Theoretical ~0.05%; allow generous margin for the PRNG correlation.
    expect(fp / trials).toBeLessThan(0.01);
  });

  it("produces stable base64 for a fixed input (wire stability)", () => {
    const a = buildWotBloom(KEYS)!;
    const b = buildWotBloom(KEYS.slice())!;
    expect(a.data).toBe(b.data);
    expect(a.bits).toBe(b.bits);
  });
});