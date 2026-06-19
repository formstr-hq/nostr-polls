/**
 * StorageAdapter — durable backing for the EventDB. Deliberately tiny and
 * platform-agnostic so the persistence logic can be tested against MemoryStorage
 * and run against IndexedDB in the Worker.
 *
 * Contract: storage is BEST-EFFORT. On Capacitor/WKWebView IndexedDB can be
 * evicted under pressure or fail transiently, so every implementation must never
 * throw out of these methods — failures degrade to "nothing persisted", and the
 * in-memory EventDB remains the runtime source of truth.
 */
import type { Event } from "../core/types";

export interface StorageAdapter {
  /** Load every persisted event (best-effort; returns [] on failure). */
  loadAll(): Promise<Event[]>;
  /** Insert/replace events by id. */
  batchPut(events: Event[]): Promise<void>;
  /** Delete events by id. */
  batchDelete(ids: string[]): Promise<void>;
  /** Drop everything. */
  clear(): Promise<void>;
}
