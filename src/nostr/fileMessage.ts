/**
 * NIP-17 kind 15 "File Message" + Blossom (NIP-B7) uploads for DM attachments.
 *
 * Contract (NIP-17, verified against the shipped implementations of Coracle +
 * Amethyst, see nostr-chat-client/interop-research.md):
 *  - The blob is encrypted CLIENT-SIDE with AES-GCM before upload — the only
 *    convention that keeps DM blobs private (Blossom servers are public).
 *  - The kind 15 rumor carries NIP-94-style fields as DIRECT tags:
 *      content          = URL of the encrypted blob (Blossom /upload result)
 *      file-type        = PRE-encryption MIME type
 *      encryption-algorithm = "aes-gcm"
 *      decryption-key   = hex AES-256 key
 *      decryption-nonce = hex 96-bit IV
 *      x                = SHA-256 of the ENCRYPTED blob (what the server stores)
 *      ox               = SHA-256 of the original file
 *      size             = encrypted byte size
 *      dim              = "w h" for images
 *    imeta is deliberately NOT used inside kind 15 (spec + Coracle practice).
 *  - Audio extensions we ship (our client renders; others ignore):
 *      duration  = seconds (float)  [NIP-A0 field vocabulary]
 *      waveform  = space-separated amplitude ints 0-100 (<100 values)
 *
 * Memory-only policy: decrypted plaintext bytes live only in session memory
 * (module blob cache + object URLs); nothing here touches localStorage or
 * IndexedDB.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { EventTemplate } from "nostr-tools";
import { dataLayer } from "@formstr/local-relay";
import { signerManager } from "../singletons/Signer/SignerManager";

/** Fallback Blossom servers when the user has no kind 10063 list (yet). */
const DEFAULT_BLOSSOM_SERVERS = [
  "https://blossom.primal.net",
  "https://cdn.satellite.earth",
  "https://nostr.build",
];

export interface FileMeta {
  url: string;
  mimeType: string; // pre-encryption (plaintext) MIME
  alg?: string; // "aes-gcm" when encrypted
  key?: string; // hex
  nonce?: string; // hex
  encryptedSha?: string; // x
  originalSha?: string; // ox
  size?: number; // bytes of the stored (encrypted) blob
  dim?: string; // "w h" for images
  duration?: number; // seconds — audio
  waveform?: number[]; // 0-100 ints — audio
  fileName?: string; // informational
}

/** Parse the direct NIP-94-style tags of a kind 15 (or imeta'd kind 14) rumor. */
export function parseFileMeta(
  tags: string[][],
  kind: number,
  content = ""
): FileMeta | null {
  if (kind === 15) {
    const get = (k: string) => tags.find((t) => t[0] === k)?.[1];
    // Spec: content holds the encrypted blob URL; url/fallback tags are
    // tolerated for senders that attach one.
    const url = get("url") || content || get("fallback") || "";

    const meta: FileMeta = {
      url: url ?? "",
      mimeType: get("file-type") ?? "application/octet-stream",
      alg: get("encryption-algorithm"),
      key: get("decryption-key"),
      nonce: get("decryption-nonce"),
      encryptedSha: get("x") ?? get("ox"),
      originalSha: get("ox"),
      size: get("size") ? parseInt(get("size") as string, 10) : undefined,
      dim: get("dim"),
      duration: get("duration") ? parseFloat(get("duration") as string) : undefined,
      waveform: get("waveform")
        ? get("waveform")!
            .trim()
            .split(/\s+/)
            .slice(0, 100)
            .map((v) => Math.max(0, Math.min(100, parseInt(v, 10) || 0)))
        : undefined,
      fileName: get("alt"),
    };
    // No usable URL anywhere (spec: content holds it, handled by caller) —
    // still return metadata; the bubble decides what to render.
    return meta;
  }

  // Legacy plaintext kind-14 attachments: NIP-92 `imeta` (space-delimited
  // key/value pairs, one per URL). Best-effort read support.
  const imeta = tags.find((t) => t[0] === "imeta")?.[1];
  if (!imeta) return null;
  const kv: Record<string, string> = {};
  for (const pair of imeta.split(/\s+/)) {
    const eq = pair.indexOf("=");
    if (eq > 0) kv[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  if (!kv.url) return null;
  return {
    url: kv.url,
    mimeType: kv.m ?? "application/octet-stream",
    encryptedSha: kv.x,
    originalSha: kv.ox,
    size: kv.size ? parseInt(kv.size, 10) : undefined,
    dim: kv.dim,
    // Plaintext attachment — no key/nonce so the bubble won't try to decrypt.
  };
}

/**
 * AES-GCM encrypt a blob in the browser. Returns the cipher bytes plus the
 * hex key + nonce to embed in the kind 15 tags.
 */
export async function encryptBlob(
  data: ArrayBuffer
): Promise<{ cipher: Uint8Array; key: string; nonce: string }> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data)
  );
  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return { cipher, key: bytesToHex(rawKey), nonce: bytesToHex(iv) };
}

/** Fetch + AES-GCM decrypt an encrypted attachment back to a plaintext Blob. */
export async function decryptBlob(meta: FileMeta): Promise<Blob> {
  if (!meta.url) throw new Error("attachment has no URL");
  if (!meta.key || !meta.nonce || meta.alg !== "aes-gcm") {
    // Plaintext (legacy imeta) attachment — just download it.
    const res = await fetch(meta.url);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    return await res.blob();
  }
  const res = await fetch(meta.url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const cipher = new Uint8Array(await res.arrayBuffer());
  if (meta.encryptedSha) {
    const digest = bytesToHex(sha256(cipher));
    if (digest !== meta.encryptedSha.toLowerCase()) {
      throw new Error("integrity check failed (sha256 mismatch)");
    }
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: hexToBytes(meta.nonce) },
    await crypto.subtle.importKey("raw", hexToBytes(meta.key), "AES-GCM", false, [
      "decrypt",
    ]),
    cipher
  );
  return new Blob([plaintext], { type: meta.mimeType });
}

/**
 * Build the tag set for a kind 15 rumor carrying an encrypted attachment.
 * `meta` must describe the ENCRYPTED blob being referenced by `url`.
 */
export function buildFileTags(meta: FileMeta): string[][] {
  const tags: string[][] = [
    ["file-type", meta.mimeType],
    ["encryption-algorithm", "aes-gcm"],
    ["decryption-key", meta.key ?? ""],
    ["decryption-nonce", meta.nonce ?? ""],
    ["size", String(meta.size ?? 0)],
  ];
  if (meta.encryptedSha) tags.push(["x", meta.encryptedSha]);
  if (meta.originalSha) tags.push(["ox", meta.originalSha]);
  if (meta.dim) tags.push(["dim", meta.dim]);
  if (meta.url) tags.push(["url", meta.url]);
  if (meta.duration !== undefined)
    tags.push(["duration", meta.duration.toFixed(3)]);
  if (meta.waveform && meta.waveform.length > 0)
    tags.push(["waveform", meta.waveform.join(" ")]);
  if (meta.fileName) tags.push(["alt", meta.fileName]);
  return tags;
}

/** base64 of a byte array — plain loop (CRA's es5 target forbids spreads). */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

/**
 * Blossom auth event (BUD-01): signed kind 24242 with t/x/expiration,
 * sent as `Authorization: Nostr <base64(json)>`.
 */
async function blossomAuth(
  verb: string,
  sha256Hex: string,
  expirationSec: number
): Promise<EventTemplate> {
  const signer = await signerManager.getSigner();
  const template: EventTemplate = {
    kind: 24242,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["t", verb],
      ["x", sha256Hex],
      ["expiration", String(expirationSec)],
    ],
    content: "",
  };
  return await signer.signEvent(template);
}

/**
 * Upload an (already-encrypted) blob to the first Blossom server that takes it
 * (BUD-06 PUT /upload with kind 24242 auth). Verifies the stored hash matches
 * what we sent; retries across servers on failure.
 */
export async function uploadToBlossom(
  blob: Uint8Array,
  mimeType: string
): Promise<{ url: string; sha256: string }> {
  const digest = bytesToHex(sha256(blob));

  // Server preference: the user's kind 10063 list (BUD-03), else defaults.
  let servers = DEFAULT_BLOSSOM_SERVERS;
  try {
    const signer = await signerManager.getSigner();
    const myPk = await signer.getPublicKey();
    if (myPk) {
      const list = await dataLayer.fetchReplaceable(10063, myPk);
      const fromList = list?.tags
        .filter((t) => t[0] === "server")
        .map((t) => t[1])
        .filter(Boolean);
      if (fromList && fromList.length > 0) servers = fromList;
    }
  } catch {
    // no server list — use defaults
  }

  const errors: string[] = [];
  for (const server of servers) {
    try {
      const auth = await blossomAuth("upload", digest, Math.floor(Date.now() / 1000) + 600);
      const res = await fetch(`${server}/upload`, {
        method: "PUT",
        headers: {
          "Content-Type": mimeType,
          Authorization: `Nostr ${bytesToBase64(
            new TextEncoder().encode(JSON.stringify(auth))
          )}`,
        },
        body: new Blob([new Uint8Array(blob)], { type: mimeType }),
      });
      if (!res.ok) {
        errors.push(`${server}: HTTP ${res.status}`);
        continue;
      }
      const descriptor = (await res.json().catch(() => null)) as {
        url?: string;
        sha256?: string;
      } | null;
      const url =
        descriptor?.url && descriptor.url.startsWith("http")
          ? descriptor.url
          : `${server.replace(/\/$/, "")}/${digest}`;
      const storedSha = descriptor?.sha256 ?? digest;
      if (storedSha.toLowerCase() !== digest) {
        errors.push(`${server}: server hash mismatch`);
        continue;
      }
      return { url, sha256: digest };
    } catch (e) {
      errors.push(`${server}: ${String(e)}`);
    }
  }
  throw new Error(`Blossom upload failed: ${errors.join("; ")}`);
}

/** "W H" for an image blob, or undefined when it can't be decoded. */
export async function measureImageDim(
  blob: Blob
): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(blob);
    const dim = `${bmp.width} ${bmp.height}`;
    if (bmp.close) bmp.close();
    return dim;
  } catch {
    return undefined;
  }
}