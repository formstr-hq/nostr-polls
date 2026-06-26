// IndexedDB-backed cache for the Web-of-Trust computation, keyed by account
// pubkey. This used to live in localStorage, but the serialized network index
// (every follow edge of everyone you follow) plus the union set can run to
// several megabytes — enough to blow Firefox's ~5MB localStorage quota, after
// which *every* localStorage write in the app throws QuotaExceededError. IndexedDB
// has a far larger, dynamic quota and is the right home for a big graph blob.

export interface WotCacheRecord {
  pubkey: string;
  // Flat list of every pubkey in the wider network (the "web of trust" set).
  union: string[];
  // The inverted network index, already JSON-serialized by the WoT worker.
  serializedIndex: string;
  // Follow suggestions ranked by the worker ({ pubkey, score }).
  recommendations: { pubkey: string; score: number }[];
  // When this was computed (ms epoch) — drives the TTL check and the "last
  // computed" display in Network settings.
  time: number;
}

const DB_NAME = "pollerama-wot";
const STORE = "wot";
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "pubkey" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getWotCache(
  pubkey: string
): Promise<WotCacheRecord | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(pubkey);
      req.onsuccess = () => resolve((req.result as WotCacheRecord) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    // IndexedDB unavailable (private mode, disabled) — treat as a cache miss.
    return null;
  }
}

export async function putWotCache(record: WotCacheRecord): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Persisting is best-effort; the index stays in memory for this session.
  }
}

export async function clearWotCacheTime(pubkey: string): Promise<void> {
  // Bust just the TTL so the next compute misses the cache, without discarding
  // the union/index that seed and grow the recompute.
  const existing = await getWotCache(pubkey);
  if (existing) await putWotCache({ ...existing, time: 0 });
}
