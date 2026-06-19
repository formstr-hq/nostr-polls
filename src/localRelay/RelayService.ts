/**
 * RelayService — the worker-side assembly of the entire local relay. Wires
 * EventDB + RelayCore (via WorkerHost) + Persistence + RelayPool + SyncEngine.
 *
 * Core invariant: the main thread only DECLARES INTERESTS (observe/observeOnce)
 * and PUBLISHES. This service owns every connection decision. It holds the set
 * of standing interests and *reconciles* its upstream subscriptions from their
 * union (deduped by filter-hash, outbox-routed) — so presentation churn never
 * opens/closes sockets directly: adding/removing an interest is the only input,
 * and the worker decides if/when/how to touch relays.
 *
 * Platform-agnostic: Channel, SocketFactory, StorageAdapter, verify, and clock
 * are injected, so it's tested end-to-end over a fake channel + FakeSocket.
 */
import type { Event, Filter } from "./core/types";
import { EventDB } from "./core/EventDB";
import { generateFilterHash } from "./core/matchFilter";
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
  /** Standing interests by subscription id (the worker's only network input). */
  private interests = new Map<string, { filters: Filter[]; sync: boolean }>();
  /** Live upstream subscriptions, deduped by filter-hash across interests. */
  private upstream = new Map<string, { filters: Filter[]; handle: SyncHandle | null }>();
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
        this.reconcile(); // new relays may let pending interests find a home
      },
      onObserve: (subId, filters, sync) => this.observe(subId, filters, sync),
      onUnobserve: (subId) => this.unobserve(subId),
      onPublish: (pubId, event) => this.publishUpstream(pubId, event),
      onRelayHealth: (reqId) => this.host.postRelayHealth(reqId, this.relayHealth()),
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
    for (const u of Array.from(this.upstream.values())) u.handle?.close();
    this.upstream.clear();
    this.interests.clear();
    this.pool.closeAll();
    await this.persistence?.stop();
  }

  // --- interests → autonomous upstream reconciliation -----------------------

  /** Register/replace a standing interest, then reconcile upstream subscriptions. */
  private observe(subId: string, filters: Filter[], sync: boolean): void {
    this.interests.set(subId, { filters, sync });
    this.reconcile();
  }

  private unobserve(subId: string): void {
    if (this.interests.delete(subId)) this.reconcile();
  }

  /**
   * Bring live upstream subscriptions in line with the union of sync-interests,
   * deduped by filter-hash so N components on the same scope share ONE upstream.
   * The worker — not the app — decides what to open and close here.
   */
  private reconcile(): void {
    if (this.paused) return;
    const desired = new Map<string, Filter[]>();
    for (const { filters, sync } of Array.from(this.interests.values())) {
      if (!sync) continue;
      const key = generateFilterHash(filters, []);
      if (!desired.has(key)) desired.set(key, filters);
    }
    // Open newly-wanted scopes.
    for (const [key, filters] of Array.from(desired.entries())) {
      if (!this.upstream.has(key)) {
        this.upstream.set(key, { filters, handle: this.openSync(filters) });
      }
    }
    // Drop scopes no interest wants anymore.
    for (const [key, entry] of Array.from(this.upstream.entries())) {
      if (!desired.has(key)) {
        entry.handle?.close();
        this.upstream.delete(key);
      }
    }
  }

  /**
   * Open a standing upstream subscription for a scope. Author-scoped filters are
   * outbox-partitioned via SyncEngine; author-less ones hit the user's relays.
   */
  private openSync(filters: Filter[]): SyncHandle {
    const handles: SyncHandle[] = [];
    for (const filter of filters) {
      const kinds = filter.kinds ?? [];
      if (filter.authors && filter.authors.length) {
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
        const id = this.pool.subscribe(this.userRelays, [filter], {
          onEvent: (event) => {
            if (this.verify(event)) this.host.ingest([event]);
          },
        });
        handles.push({ close: () => this.pool.unsubscribe(id) });
      }
    }
    return { close: () => handles.forEach((h) => h.close()) };
  }

  // --- writes ---------------------------------------------------------------

  /**
   * Publish a client event upstream with per-relay tracking. Targets are the
   * author's write relays (outbox) ∪ the user's relays, plus the inbox relays of
   * any p-tagged pubkey (gossip). The worker owns routing; retry is just another
   * publish. Always reports a result so the diagnostics UI never hangs.
   */
  private publishUpstream(pubId: string, event: Event): void {
    this.pool.publish(this.publishTargets(event), event, {
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

  // --- lifecycle ------------------------------------------------------------

  /** App backgrounded: close every socket, keep the store + interests. */
  private pause(): void {
    this.paused = true;
    for (const entry of Array.from(this.upstream.values())) {
      entry.handle?.close();
      entry.handle = null;
    }
    this.upstream.clear();
    this.pool.closeAll();
  }

  /** App foregrounded: reconcile reopens the upstream from standing interests. */
  private resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.reconcile();
  }

  // --- helpers --------------------------------------------------------------

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

  /** Live connection health for the user's relays (configured + any connected). */
  private relayHealth() {
    const fromPool = this.pool.relayHealth();
    const seen = new Set(fromPool.map((h) => h.relay));
    const missing = Array.from(new Set(this.userRelays))
      .filter((r) => !seen.has(r))
      .map((relay) => ({ relay, connected: false, connecting: false, reconnecting: false }));
    return [...fromPool, ...missing];
  }
}
