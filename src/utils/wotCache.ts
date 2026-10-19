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
  // False when the run that produced this record did not finish — e.g. the
  // first (1-degree) pass committed before the optional 2-degree hop, the
  // hard timeout fired, or too few contact lists arrived. Such a record is
  // still a valid *seed* (its union is a floor for the next run) but must not
  // be trusted as final for the whole TTL: otherwise a sparse run can leave
  // someone stuck at their 1-degree / contact-list-sized network for days.
  // Older records have no field; absent means complete.
  complete?: boolean;
}

const DB_NAME = "pollerama-wot";
const STORE = "wot";
const VERSION = 1;

// Suffix-keyed compact mirror of the union (no index/recommendations). The
// index can be tens of megabytes on a large 2-degree graph; if writing it
// fails (quota, a killed tab, a blocked transaction) we must not lose the
// union itself. The mirror is written first and read as a fallback.
const UNION_MIRROR_SUFFIX = ":union";

function unionMirrorKey(pubkey: string): string {
  return pubkey + UNION_MIRROR_SUFFIX;
}

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

async function readRecord(key: string): Promise<WotCacheRecord | null> {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as WotCacheRecord) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function writeRecord(record: WotCacheRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Read the best known cache record for `pubkey`. Prefers whichever of the full
 * record and the union-only mirror holds the larger union, so a mirror written
 * by a newer/larger run is never shadowed by an older full record. A mirror hit
 * comes back without an index (`complete: false`) — callers treat that as
 * "restore the union, then recompute the index".
 */
export async function getWotCache(
  pubkey: string
): Promise<WotCacheRecord | null> {
  try {
    const [full, mirror] = await Promise.all([
      readRecord(pubkey),
      readRecord(unionMirrorKey(pubkey)),
    ]);
    const fullSize = full?.union?.length ?? 0;
    const mirrorSize = mirror?.union?.length ?? 0;
    if (mirrorSize > fullSize) {
      return {
        pubkey,
        union: mirror!.union,
        serializedIndex: "",
        recommendations: [],
        time: mirror!.time,
        complete: false,
      };
    }
    return full ?? null;
  } catch {
    // IndexedDB unavailable (private mode, disabled) — treat as a cache miss.
    return null;
  }
}

export async function putWotCache(record: WotCacheRecord): Promise<void> {
  try {
    // Compact union mirror first: even if the (much larger) full record fails
    // to commit, the next launch still seeds from this network instead of
    // falling back to a partial/1-degree fetch.
    await writeRecord({
      pubkey: unionMirrorKey(record.pubkey),
      union: record.union,
      serializedIndex: "",
      recommendations: [],
      time: record.time,
      complete: record.complete,
    });
    await writeRecord(record);
  } catch {
    // Persisting is best-effort; the index stays in memory for this session.
  }
}

/**
 * Is `record` a complete, fresh result that can be served without recomputing?
 * `complete === false` explicitly marks a partial run (see WotCacheRecord);
 * records from older versions have no flag and count as complete.
 */
export function isWotCacheFresh(
  record: WotCacheRecord | null | undefined,
  ttlMs: number,
  now: number = Date.now(),
  force = false
): boolean {
  return (
    !force &&
    !!record &&
    Array.isArray(record.union) &&
    record.union.length > 0 &&
    record.time > 0 &&
    record.complete !== false &&
    now - record.time < ttlMs
  );
}

export async function clearWotCacheTime(pubkey: string): Promise<void> {
  // Bust just the TTL so the next compute misses the cache, without discarding
  // the union/index that seed and grow the recompute.
  const existing = await getWotCache(pubkey);
  if (existing) await putWotCache({ ...existing, time: 0 });
}
