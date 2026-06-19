/**
 * RelayService — the worker-side assembly of the entire local relay. Wires
 * EventDB + RelayCore (via WorkerHost) + Persistence + RelayPool + SyncEngine,
 * and implements the core policy:
 *
 *   A client REQ is served from the local store immediately (RelayCore replay +
 *   live tail) AND triggers an outbox-partitioned upstream fetch (SyncEngine)
 *   that streams verified events back into the store — which then flow to the
 *   live subscription. So one `subscribe` gives cache + network with no extra
 *   API surface.
 *
 * It's platform-agnostic: Channel, SocketFactory, StorageAdapter, verify, and
 * clock are all injected, so the whole service is tested end-to-end over a fake
 * channel + FakeSocket. The actual Worker entry file (relay.worker.ts) is a thin
 * shell that constructs this with real platform pieces.
 */
import type { Event, Filter } from "./core/types";
import { EventDB } from "./core/EventDB";
import { Channel } from "./transport/channel";
import { WorkerHost } from "./transport/WorkerHost";
import { RelayPool } from "./sync/RelayPool";
import { SyncEngine, SyncHandle, defaultVerify } from "./sync/SyncEngine";
import { SocketFactory, webSocketFactory } from "./sync/Socket";
import { StorageAdapter } from "./storage/StorageAdapter";
import { Persistence, PersistenceOptions } from "./storage/persistence";

export interface RelayServiceOptions {
  channel: Channel;
  socketFactory?: SocketFactory;
  storage?: StorageAdapter;
  persistence?: PersistenceOptions;
  verify?: (event: Event) => boolean;
  now?: () => number;
}

export class RelayService {
  readonly db: EventDB;
  private host: WorkerHost;
  private pool: RelayPool;
  private sync: SyncEngine;
  private persistence: Persistence | null;
  private userRelays: string[] = [];
  /** Deduped long-lived upstream subscriptions, keyed by filter-hash. */
  private syncs = new Map<string, { filters: Filter[]; handle: SyncHandle | null }>();
  private paused = false;
  private verify: (event: Event) => boolean;

  constructor(opts: RelayServiceOptions) {
    this.verify = opts.verify ?? defaultVerify;
    this.db = new EventDB(opts.now);
    this.pool = new RelayPool(opts.socketFactory ?? webSocketFactory);
    this.host = new WorkerHost(opts.channel, this.db, {
      onSetUserRelays: (relays) => {
        this.userRelays = relays;
      },
      // Local REQ does NOT touch the network — upstream sync is decoupled.
      onStartSync: (key, filters) => this.startSync(key, filters),
      onStopSync: (key) => this.stopSync(key),
      onFetchPage: (filters) => this.fetchPage(filters),
      onPublish: (event) => this.publishUpstream(event),
      onPause: () => this.pause(),
      onResume: () => this.resume(),
      // onSetAccount handled by the cutover wiring (retarget feeds); the shared
      // public store does not need a swap.
    });
    this.sync = new SyncEngine({
      pool: this.pool,
      ingest: (events) => this.host.ingest(events),
      getWriteRelays: (pk) => this.getWriteRelays(pk),
      verify: opts.verify,
    });
    this.persistence = opts.storage
      ? new Persistence(this.db, opts.storage, opts.persistence)
      : null;
  }

  /** Hydrate from storage and begin write-through + pruning. */
  async start(): Promise<void> {
    await this.persistence?.start();
  }

  async stop(): Promise<void> {
    for (const s of Array.from(this.syncs.values())) s.handle?.close();
    this.syncs.clear();
    this.pool.closeAll();
    await this.persistence?.stop();
  }

  /** Outbox cache IS the store: parse the latest kind-10002 for this pubkey. */
  private getWriteRelays(pubkey: string): string[] {
    const [event] = this.db.query({ kinds: [10002], authors: [pubkey], limit: 1 });
    if (!event) return [];
    const write: string[] = [];
    for (const tag of event.tags) {
      if (tag[0] !== "r" || !tag[1]) continue;
      if (!tag[2] || tag[2] === "write") write.push(tag[1]);
    }
    return write;
  }

  /**
   * Send a client-published event to the network: the author's own write relays
   * (outbox) unioned with the user's relays as a floor, so a published note
   * always lands somewhere even before the author's kind-10002 is known.
   */
  private publishUpstream(event: Event): void {
    const targets = Array.from(
      new Set([...this.getWriteRelays(event.pubkey), ...this.userRelays])
    );
    if (targets.length) this.pool.publish(targets, event);
  }

  /** Start (or no-op if already running) a deduped upstream sync for a scope. */
  private startSync(key: string, filters: Filter[]): void {
    if (this.syncs.has(key)) return; // already syncing this scope
    const handle = this.paused ? null : this.openFetch(filters, false);
    this.syncs.set(key, { filters, handle });
  }

  private stopSync(key: string): void {
    const entry = this.syncs.get(key);
    if (!entry) return;
    entry.handle?.close();
    this.syncs.delete(key);
  }

  /** One-shot bounded backfill: closes each bucket after its EOSE. */
  private fetchPage(filters: Filter[]): void {
    if (this.paused) return;
    this.openFetch(filters, true);
  }

  /** App suspended: close every socket but keep the store + sync specs. */
  private pause(): void {
    this.paused = true;
    for (const entry of Array.from(this.syncs.values())) {
      entry.handle?.close();
      entry.handle = null;
    }
    this.pool.closeAll();
  }

  /** App resumed: reconnect each sync from its stored spec. */
  private resume(): void {
    if (!this.paused) return;
    this.paused = false;
    for (const entry of Array.from(this.syncs.values())) {
      entry.handle = this.openFetch(entry.filters, false);
    }
  }

  /**
   * Open upstream fetches for a set of filters. Author-scoped filters are
   * outbox-partitioned via SyncEngine; author-less ones (ids/tags/global) hit
   * the user's relays directly. When `oneShot`, each bucket closes on its EOSE.
   */
  private openFetch(filters: Filter[], oneShot: boolean): SyncHandle {
    const handles: SyncHandle[] = [];
    for (const filter of filters) {
      const kinds = filter.kinds ?? [];
      if (filter.authors && filter.authors.length) {
        const handle: SyncHandle = this.sync.fetch(
          {
            kinds,
            authors: filter.authors,
            userRelays: this.userRelays,
            since: filter.since,
            until: filter.until,
            limit: filter.limit,
          },
          oneShot ? () => handle.close() : undefined
        );
        handles.push(handle);
      } else if (this.userRelays.length) {
        const id = this.pool.subscribe(
          this.userRelays,
          [filter],
          {
            onEvent: (event) => {
              if (this.verify(event)) this.host.ingest([event]);
            },
            onEose: oneShot ? () => this.pool.unsubscribe(id) : undefined,
          }
        );
        handles.push({ close: () => this.pool.unsubscribe(id) });
      }
    }
    return { close: () => handles.forEach((h) => h.close()) };
  }
}
