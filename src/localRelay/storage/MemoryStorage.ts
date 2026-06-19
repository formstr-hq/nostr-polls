/**
 * In-memory StorageAdapter for tests and Node/SSR. Synchronous under the hood,
 * wrapped in resolved promises to honour the async contract.
 */
import type { Event } from "../core/types";
import { StorageAdapter } from "./StorageAdapter";

export class MemoryStorage implements StorageAdapter {
  private map = new Map<string, Event>();

  async loadAll(): Promise<Event[]> {
    return Array.from(this.map.values());
  }

  async batchPut(events: Event[]): Promise<void> {
    for (const e of events) this.map.set(e.id, e);
  }

  async batchDelete(ids: string[]): Promise<void> {
    for (const id of ids) this.map.delete(id);
  }

  async clear(): Promise<void> {
    this.map.clear();
  }

  /** Test-only synchronous size accessor. */
  get size(): number {
    return this.map.size;
  }
}
