/**
 * Sidecar localStorage cache for kind-0 metadata (name/picture/about)
 * keyed by pubkey. Decoupled from the active signer so account avatars
 * render instantly on reload even before relays return profile data.
 *
 * @formstr/signer intentionally keeps `StoredAccount` minimal
 * ({npub, pubkey, method, ...}) — this cache holds everything else we
 * used to embed in our own StoredAccount.userData.
 */
const KEY = "pollerama:userProfileCache";

export type CachedUserData = {
  name?: string;
  picture?: string;
  about?: string;
};

type Cache = Record<string, CachedUserData>;

function read(): Cache {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Cache;
  } catch {
    return {};
  }
}

function write(cache: Cache) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Ignore quota errors
  }
}

export function getCachedUserData(pubkey: string): CachedUserData | undefined {
  return read()[pubkey];
}

export function setCachedUserData(pubkey: string, data: CachedUserData): void {
  const cache = read();
  cache[pubkey] = data;
  write(cache);
}

export function removeCachedUserData(pubkey: string): void {
  const cache = read();
  delete cache[pubkey];
  write(cache);
}
