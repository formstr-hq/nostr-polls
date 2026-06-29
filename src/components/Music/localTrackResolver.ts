// Resolves local audio files to playable URLs, and matches a playlist's stored
// fingerprint back to a file on this device. Module-level (not component) state so
// object URLs survive route changes while the global player keeps playing — the
// reason the per-component cache in LocalMusic could revoke a URL out from under a
// track that was still playing after you navigated away.
//
// Byte resolution is tiered exactly as the store is:
//   • FSA handle  → getFile() (after a permission confirm) → object URL
//   • blob copy   → object URL
//   • known url   → used as-is (native content:// URIs registered by LocalMusic)
import {
  ensureReadPermission,
  getEntryByFingerprint,
  StoredEntry,
} from "./localMusicStore";

// id → playable URL (object URL for blobs/handles, content:// for native).
const urlCache = new Map<string, string>();
// id → FileSystemFileHandle, re-read on demand (zero-copy reference, Chromium).
const handles = new Map<string, any>();
// id → File blob (Firefox/Safari copy), turned into an object URL lazily.
const blobs = new Map<string, Blob>();

// Make a stored entry resolvable. Idempotent — safe to call from both LocalMusic
// (which loads the whole library) and the playlist resolver below.
export function registerEntry(e: StoredEntry): void {
  if (e.handle) handles.set(e.id, e.handle);
  else if (e.blob) blobs.set(e.id, e.blob);
}

// Register an already-playable URL (native content:// URI from MediaStore).
export function registerUrl(id: string, url: string): void {
  urlCache.set(id, url);
}

// Resolve a registered track to a playable URL, reading/converting at most once.
// FSA handles prompt for read permission on first resolve, so the first call for
// such a track MUST originate from a user gesture (e.g. a play click).
export async function resolveUrl(id: string): Promise<string | null> {
  const cached = urlCache.get(id);
  if (cached) return cached;

  const blob = blobs.get(id);
  if (blob) {
    const url = URL.createObjectURL(blob);
    urlCache.set(id, url);
    return url;
  }

  const handle = handles.get(id);
  if (!handle) return null;
  if (!(await ensureReadPermission(handle))) return null;
  const file = await handle.getFile();
  const url = URL.createObjectURL(file);
  urlCache.set(id, url);
  return url;
}

// Forget a track and revoke its object URL (called when a file is removed from the
// library). A no-op revoke on a content:// URL is harmless.
export function release(id: string): void {
  const url = urlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
  }
  handles.delete(id);
  blobs.delete(id);
}

// Whether a local file with this fingerprint exists on this device. A pure
// IndexedDB metadata read — never touches bytes or prompts for permission — so
// it's safe for greying-out unavailable playlist rows on load.
export async function hasFingerprint(fingerprint: string): Promise<boolean> {
  return Boolean(await getEntryByFingerprint(fingerprint));
}

// Match a playlist's local-track fingerprint to a file on this device and resolve
// it to a playable URL. Returns null when the file isn't present here (the row is
// shown as unavailable). Like resolveUrl, a first FSA resolve needs a user gesture.
export async function resolveByFingerprint(
  fingerprint: string
): Promise<{ id: string; url: string } | null> {
  const entry = await getEntryByFingerprint(fingerprint);
  if (!entry) return null;
  registerEntry(entry);
  const url = await resolveUrl(entry.id);
  return url ? { id: entry.id, url } : null;
}
