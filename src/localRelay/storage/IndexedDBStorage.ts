/**
 * IndexedDBStorage — dependency-free, best-effort durable backing for the Worker.
 *
 * Every operation is wrapped so it NEVER throws: on WKWebView (Capacitor)
 * IndexedDB can be evicted under storage pressure or fail transiently (e.g. the
 * iOS 17.4 "Connection to Indexed Database server lost" regression). When that
 * happens we degrade silently to "nothing persisted" — the in-memory EventDB is
 * the runtime source of truth and keeps working.
 *
 * Single object store keyed by event id. Runs in a Worker (uses global
 * indexedDB; no DOM). Not unit-tested in jsdom (no IndexedDB there) — the
 * persistence LOGIC is tested against MemoryStorage; this file is platform glue.
 *
 * MULTI-ACCOUNT: the relay caches PUBLIC, global events (notes, profiles,
 * contacts, polls, articles, encrypted gift-wrap ciphertext…), so it uses a
 * SINGLE SHARED database across all accounts — storing them per-account would
 * duplicate bytes and force a refetch on every switch. Switching accounts
 * changes the *selection* (authors/scope) and sync targets, not the stored
 * events. Genuinely private data (decrypted NIP-17 DM rumors) never enters this
 * store — it stays in the account-scoped DM layer. The optional `namespace` is
 * for that rare per-account private store, not for public events.
 */
import type { Event } from "../core/types";
import { StorageAdapter } from "./StorageAdapter";

const DB_PREFIX = "pollerama-local-relay";
const DB_VERSION = 1;
const STORE = "events";

/** Database name. Default is the shared public store; a namespace scopes a
 * separate (e.g. per-account private) store. */
export function dbNameFor(namespace = "shared"): string {
  return `${DB_PREFIX}:${namespace}`;
}

export class IndexedDBStorage implements StorageAdapter {
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private readonly dbName: string;

  /** @param namespace defaults to the shared public store. */
  constructor(namespace = "shared") {
    this.dbName = dbNameFor(namespace);
  }

  private open(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve) => {
      try {
        if (typeof indexedDB === "undefined") return resolve(null);
        const req = indexedDB.open(this.dbName, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: "id" });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.dbPromise;
  }

  private async tx(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => void
  ): Promise<void> {
    const db = await this.open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const transaction = db.transaction(STORE, mode);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
        run(transaction.objectStore(STORE));
      } catch {
        // A failed transaction (e.g. connection lost) drops this batch; the DB
        // already has it in memory, so we just lose durability for these events.
        resolve();
      }
    });
  }

  async loadAll(): Promise<Event[]> {
    const db = await this.open();
    if (!db) return [];
    return new Promise((resolve) => {
      try {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result as Event[]) ?? []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  async batchPut(events: Event[]): Promise<void> {
    await this.tx("readwrite", (store) => {
      for (const e of events) store.put(e);
    });
  }

  async batchDelete(ids: string[]): Promise<void> {
    await this.tx("readwrite", (store) => {
      for (const id of ids) store.delete(id);
    });
  }

  async clear(): Promise<void> {
    await this.tx("readwrite", (store) => store.clear());
  }

  /** Close and delete this account's entire database (account removal). */
  async destroy(): Promise<void> {
    const db = await this.open();
    try {
      db?.close();
    } catch {
      /* ignore */
    }
    this.dbPromise = null;
    await new Promise<void>((resolve) => {
      try {
        if (typeof indexedDB === "undefined") return resolve();
        const req = indexedDB.deleteDatabase(this.dbName);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}
