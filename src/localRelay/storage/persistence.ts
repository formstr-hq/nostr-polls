/**
 * Persistence — bridges the in-memory EventDB to a durable StorageAdapter.
 *
 *  - Write-through: subscribes to EventDB changes and batches them to storage on
 *    a debounce, so a burst of ingested events becomes a few bulk writes.
 *  - Hydration: loads persisted events into the DB on boot (no change-echo).
 *  - Pruning: periodically calls EventDB.prune(); the resulting `remove` changes
 *    flow through the same write-through path and get deleted from storage too.
 *
 * All storage calls are best-effort (StorageAdapter never throws); a storage
 * failure just means data isn't durable this session — the DB keeps working.
 */
import { EventDB } from "../core/EventDB";
import { Event, PrunePolicy, defaultPrunePolicy } from "../core/types";
import { StorageAdapter } from "./StorageAdapter";

export interface PersistenceOptions {
  debounceMs?: number;
  pruneIntervalMs?: number;
  prunePolicy?: PrunePolicy;
}

const DEFAULTS = {
  debounceMs: 1000,
  pruneIntervalMs: 5 * 60 * 1000,
};

export class Persistence {
  private pendingPuts = new Map<string, Event>();
  private pendingDeletes = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private detach: (() => void) | null = null;
  private readonly opts: Required<PersistenceOptions>;

  constructor(
    private db: EventDB,
    private storage: StorageAdapter,
    options: PersistenceOptions = {}
  ) {
    this.opts = {
      debounceMs: options.debounceMs ?? DEFAULTS.debounceMs,
      pruneIntervalMs: options.pruneIntervalMs ?? DEFAULTS.pruneIntervalMs,
      prunePolicy: options.prunePolicy ?? defaultPrunePolicy(),
    };
  }

  /** Load persisted events into the DB, then begin write-through + pruning. */
  async start(): Promise<void> {
    const events = await this.storage.loadAll();
    if (events.length) this.db.bulkLoad(events);

    this.detach = this.db.onChange((change) => {
      if (change.type === "add") {
        this.pendingDeletes.delete(change.event.id);
        this.pendingPuts.set(change.event.id, change.event);
      } else {
        this.pendingPuts.delete(change.id);
        this.pendingDeletes.add(change.id);
      }
      this.scheduleFlush();
    });

    if (this.opts.pruneIntervalMs > 0) {
      this.pruneTimer = setInterval(() => this.pruneNow(), this.opts.pruneIntervalMs);
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.opts.debounceMs);
  }

  /** Force-write any queued changes. Safe to call manually (tests, shutdown). */
  async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.pendingPuts.size === 0 && this.pendingDeletes.size === 0) return;
    this.flushing = true;

    const puts = Array.from(this.pendingPuts.values());
    const deletes = Array.from(this.pendingDeletes);
    this.pendingPuts.clear();
    this.pendingDeletes.clear();

    try {
      if (puts.length) await this.storage.batchPut(puts);
      if (deletes.length) await this.storage.batchDelete(deletes);
    } finally {
      this.flushing = false;
    }
  }

  /** Run a prune pass now. Removals propagate to storage via write-through. */
  pruneNow(): number {
    return this.db.prune(this.opts.prunePolicy);
  }

  /** Stop timers and flush a final time. */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    this.detach?.();
    this.detach = null;
    await this.flush();
  }
}
