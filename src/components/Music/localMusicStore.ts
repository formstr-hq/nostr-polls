// Persists user-selected local audio across sessions, tiered by capability:
//   • Chromium (File System Access API): store the FileSystemFileHandle — a
//     REFERENCE to the file on disk. No data is duplicated.
//   • Firefox / Safari (no FSA): store the File blob itself. This works, but it
//     keeps a COPY in IndexedDB since those browsers expose no handle to
//     reference. localStorage can't be used either way (binary + URL lifetime).
const DB_NAME = "pollerama-local-music";
const STORE = "entries";
const VERSION = 1;

export interface StoredEntry {
  id: string;
  name: string;
  // Exactly one of these is set. `handle` (FileSystemFileHandle) is typed loosely
  // so this compiles without the FSA lib; `blob` is the copy fallback.
  handle?: any;
  blob?: Blob;
}

export const fsaSupported = (): boolean =>
  typeof (window as any).showOpenFilePicker === "function";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllEntries(): Promise<StoredEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as StoredEntry[]);
    req.onerror = () => reject(req.error);
  });
}

export async function putEntries(entries: StoredEntry[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    entries.forEach((e) => store.put(e));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteEntry(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Ensure read permission for a stored handle, prompting if needed. MUST be called
// from a user gesture (e.g. a play click) so requestPermission can show its prompt.
export async function ensureReadPermission(handle: any): Promise<boolean> {
  const opts = { mode: "read" };
  if ((await handle.queryPermission?.(opts)) === "granted") return true;
  return (await handle.requestPermission?.(opts)) === "granted";
}
