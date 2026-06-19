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
  private now: () => number;

  constructor(opts: RelayServiceOptions) {
    this.verify = opts.verify ?? defaultVerify;
    this.now = opts.now ?? (() => Date.now());
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
      onPublish: (pubId, event, relays) => this.publishUpstream(pubId, event, relays),
      onResetRelays: (relays) => this.pool.resetRelays(relays),
      onRelayHealth: (reqId) => this.host.postRelayHealth(reqId, this.relayHealth()),
      onQuery: (reqId, filters) => this.runQuery(reqId, filters),
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
    return this.relaysFromNip65(pubkey, "write");
  }

  /** Inbox relays — where a recipient reads — for gossip delivery of mentions. */
  private getReadRelays(pubkey: string): string[] {
    return this.relaysFromNip65(pubkey, "read");
  }

  /** Parse a pubkey's latest kind-10002, returning the relays for one direction. */
  private relaysFromNip65(pubkey: string, dir: "read" | "write"): string[] {
    const [event] = this.db.query({ kinds: [10002], authors: [pubkey], limit: 1 });
    if (!event) return [];
    const out: string[] = [];
    for (const tag of event.tags) {
      if (tag[0] !== "r" || !tag[1]) continue;
      // An unmarked "r" tag is both read and write.
      if (!tag[2] || tag[2] === dir) out.push(tag[1]);
    }
    return out;
  }

  /**
   * Publish a client event upstream with per-relay tracking. Targets are the
   * author's write relays (outbox) ∪ the user's relays, plus the inbox relays of
   * any p-tagged pubkey (gossip — so mentions/DMs actually reach recipients).
   * An explicit `relays` list (retry) overrides routing. Always reports a result
   * so the diagnostics UI never hangs.
   */
  private publishUpstream(pubId: string, event: Event, explicitRelays?: string[]): void {
    const targets = explicitRelays?.length
      ? Array.from(new Set(explicitRelays))
      : this.publishTargets(event);
    this.pool.publish(targets, event, {
      now: this.now,
      onResult: (results) => this.host.postPublishResult(pubId, results),
    });
  }

  private publishTargets(event: Event): string[] {
    const targets = new Set<string>([...this.getWriteRelays(event.pubkey), ...this.userRelays]);
    for (const tag of event.tags) {
      if (tag[0] === "p" && tag[1]) {
        for (const relay of this.getReadRelays(tag[1])) targets.add(relay);
      }
    }
    return Array.from(targets);
  }

  /** Live connection health for the user's relays (configured + any connected). */
  private relayHealth() {
    const known = Array.from(new Set([...this.userRelays]));
    const fromPool = this.pool.relayHealth();
    const seen = new Set(fromPool.map((h) => h.relay));
    // Include configured relays we haven't opened yet, so the user sees them all.
    const missing = known
      .filter((r) => !seen.has(r))
      .map((relay) => ({ relay, connected: false, connecting: false, reconnecting: false }));
    return [...fromPool, ...missing];
  }

  /**
   * One-shot read: fire a bounded upstream fetch for each filter (verified events
   * stream into the store), wait for all to reach EOSE, then return the store's
   * matches — local cache ∪ freshly-fetched, deduped by the store. Backs the
   * imperative reads (query / fetchOne / fetchBatched / get).
   */
  private async runQuery(reqId: string, filters: Filter[]): Promise<void> {
    await Promise.all(filters.map((filter) => this.fetchOnce(filter)));
    const collected = new Map<string, Event>();
    for (const filter of filters) {
      for (const event of this.db.query(filter)) collected.set(event.id, event);
    }
    this.host.postQueryResult(reqId, Array.from(collected.values()));
  }

  /** Upstream fetch for one filter that resolves on its combined EOSE (or deadline). */
  private fetchOnce(filter: Filter): Promise<void> {
    return new Promise((resolve) => {
      if (this.paused) return resolve();
      const kinds = filter.kinds ?? [];
      if (filter.authors && filter.authors.length) {
        const handle = this.sync.fetch(
          {
            kinds,
            authors: filter.authors,
            userRelays: this.userRelays,
            since: filter.since,
            until: filter.until,
            limit: filter.limit,
          },
          () => {
            handle.close();
            resolve();
          }
        );
      } else if (this.userRelays.length) {
        const id = this.pool.subscribe(this.userRelays, [filter], {
          onEvent: (event) => {
            if (this.verify(event)) this.host.ingest([event]);
          },
          onEose: () => {
            this.pool.unsubscribe(id);
            resolve();
          },
        });
      } else {
        resolve();
      }
    });
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
