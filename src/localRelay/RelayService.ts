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
  private fetches = new Map<string, SyncHandle>();
  private verify: (event: Event) => boolean;

  constructor(opts: RelayServiceOptions) {
    this.verify = opts.verify ?? defaultVerify;
    this.db = new EventDB(opts.now);
    this.pool = new RelayPool(opts.socketFactory ?? webSocketFactory);
    this.host = new WorkerHost(opts.channel, this.db, {
      onSetUserRelays: (relays) => {
        this.userRelays = relays;
      },
      onReq: (subId, filters) => this.startFetch(subId, filters),
      onClose: (subId) => this.stopFetch(subId),
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
    for (const h of Array.from(this.fetches.values())) h.close();
    this.fetches.clear();
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

  private startFetch(subId: string, filters: Filter[]): void {
    this.stopFetch(subId); // replace any prior fetch for this sub id
    const handles: SyncHandle[] = [];
    for (const filter of filters) {
      const kinds = filter.kinds ?? [];
      if (filter.authors && filter.authors.length) {
        // Author-scoped: outbox-partition the fetch.
        handles.push(
          this.sync.fetch({
            kinds,
            authors: filter.authors,
            userRelays: this.userRelays,
            since: filter.since,
            until: filter.until,
            limit: filter.limit,
          })
        );
      } else if (this.userRelays.length) {
        // Author-less (ids/tags/global): fetch raw from the user's relays.
        const id = this.pool.subscribe(this.userRelays, [filter], {
          onEvent: (event) => {
            if (this.verify(event)) this.host.ingest([event]);
          },
        });
        handles.push({ close: () => this.pool.unsubscribe(id) });
      }
    }
    if (handles.length) {
      this.fetches.set(subId, { close: () => handles.forEach((h) => h.close()) });
    }
  }

  private stopFetch(subId: string): void {
    const handle = this.fetches.get(subId);
    if (handle) {
      handle.close();
      this.fetches.delete(subId);
    }
  }
}
