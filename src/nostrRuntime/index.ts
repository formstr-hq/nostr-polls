import { Event, Filter, Relay, SimplePool } from 'nostr-tools';
import { EventStore } from './EventStore';
import { SubscriptionManager } from './SubscriptionManager';
import {
  SubscribeOptions,
  SubscriptionHandle,
  RuntimeStats,
  SubscriptionDebugInfo,
} from './types';
import { poolNormalizeUrl } from './utils/filterUtils';

/**
 * NostrRuntime - Centralized Nostr subscription and event storage
 *
 * Main API for interacting with Nostr events in the application.
 * Provides:
 * - Centralized event storage with multi-index queries
 * - Automatic subscription deduplication
 * - Simple query interface for components
 * - Integration with existing SimplePool and Throttler systems
 *
 * Usage:
 * ```typescript
 * import { nostrRuntime } from './singletons';
 *
 * // Query cached events (synchronous, no network)
 * const profiles = nostrRuntime.query({ kinds: [0], authors: ['pubkey'] });
 *
 * // Subscribe to events (network + cache)
 * const handle = nostrRuntime.subscribe(
 *   ['wss://relay.example.com'],
 *   [{ kinds: [1], limit: 100 }],
 *   {
 *     onEvent: (event) => console.log('New event:', event),
 *     onEose: () => console.log('Subscription ready'),
 *   }
 * );
 *
 * // Clean up
 * handle.unsubscribe();
 * ```
 */
export class NostrRuntime {
  private pool: SimplePool;
  public eventStore: EventStore;
  private subscriptionManager: SubscriptionManager;

  constructor(pool: SimplePool) {
    this.pool = pool;
    this.eventStore = new EventStore();
    this.subscriptionManager = new SubscriptionManager(pool, this.eventStore);

    // Belt-and-suspenders: evict dead relay connections every 60 s.
    // Catches sockets that died unexpectedly (NAT timeout, server restart)
    // and were never cleaned up by releaseRelays.
    setInterval(() => {
      const poolRelays = (this.pool as any).relays as Map<string, any>;
      if (poolRelays.size === 0) return;
      this.cleanStaleRelays(Array.from(poolRelays.keys()));
    }, 60_000);

    // Connection watchdog: while the tab is foregrounded and online, detect
    // active subscriptions whose underlying socket has silently died (relay
    // idle-close, server restart, NAT timeout) and reconnect them. The
    // visibilitychange/online reconnect triggers in App.tsx don't cover a tab
    // that simply stays open for a long time — this does.
    setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      this.checkConnectionHealth();
    }, 30_000);
  }

  /**
   * Query cached events (synchronous, no network)
   * Returns events matching the filter, sorted by created_at (newest first)
   *
   * @param filter - Nostr filter to match events
   * @returns Array of matching events
   */
  query(filter: Filter): Event[] {
    return this.eventStore.query(filter);
  }

  /**
   * Get a single event by ID (synchronous, cache only)
   *
   * @param id - Event ID
   * @returns Event if found, undefined otherwise
   */
  get(id: string): Event | undefined {
    return this.eventStore.getById(id);
  }

  /**
   * Subscribe to events (network + cache)
   *
   * Behavior:
   * 1. Immediately queries cache and calls onEvent for each cached event
   * 2. Creates network subscription (or reuses existing) for new events
   * 3. Calls onEvent for each new event received
   * 4. Calls onEose when subscription reaches end-of-stored-events
   *
   * Deduplication:
   * - If another subscription with identical filters + relays exists, reuses it
   * - Automatically manages reference counting and cleanup
   *
   * @param relays - Array of relay URLs
   * @param filters - Array of Nostr filters
   * @param options - Subscription options
   * @returns SubscriptionHandle with unsubscribe function
   */
  subscribe(
    relays: string[],
    filters: Filter[],
    options?: SubscribeOptions
  ): SubscriptionHandle {
    const { onEvent, onEose, localOnly, fresh } = options || {};

    // If localOnly, just query cache and return
    if (localOnly) {
      if (onEvent) {
        // Query cache for each filter
        for (const filter of filters) {
          const events = this.eventStore.query(filter);
          for (const event of events) {
            onEvent(event);
          }
        }
      }

      // Call onEose immediately
      if (onEose) {
        onEose();
      }

      // Return dummy handle
      return {
        id: 'local-only',
        unsubscribe: () => {}, // No-op
      };
    }

    // Deliver cached events immediately (skip when fresh — caller wants network-only data)
    if (onEvent && !fresh) {
      for (const filter of filters) {
        const cachedEvents = this.eventStore.query(filter);
        for (const event of cachedEvents) {
          onEvent(event);
        }
      }
    }

    // When fresh=true:
    // 1. Force-close pool WebSocket connections for these relays AND remove
    //    the relay objects from the pool's internal map. This forces
    //    ensureRelay() to create brand-new relay objects with fresh TCP
    //    connections. Without this, a silently-dead WebSocket (NAT timeout,
    //    mobile background) still has _connected=true and a resolved
    //    connectionPromise — pool.close() alone won't fix it because the
    //    relay's ws.onclose handler skips cleanup when _connected is already
    //    false (set by close()). nostr-tools then fires a fake EOSE via its
    //    4.4s timeout, making it look like the refresh worked when zero
    //    events were actually received.
    // 2. Append a nonce to bypass subscription deduplication.
    if (fresh) {
      this.pool.close(relays);
      // Remove stale relay objects so ensureRelay() creates new ones.
      // Match using the same normalizeURL logic nostr-tools uses internally.
      const poolRelays = (this.pool as any).relays as Map<string, unknown>;
      const normalizedTargets = new Set(relays.map(poolNormalizeUrl).filter(Boolean));
      for (const key of Array.from(poolRelays.keys())) {
        if (normalizedTargets.has(key)) poolRelays.delete(key);
      }
    }

    const { id, unsubscribe } = this.subscriptionManager.subscribe(
      relays,
      filters,
      onEvent,
      onEose,
      fresh ? `fresh-${Date.now()}-${Math.random()}` : undefined
    );

    return { id, unsubscribe };
  }

  /**
   * Check whether an event ID has been marked as deleted (NIP-09)
   */
  isDeleted(id: string): boolean {
    return this.eventStore.isDeleted(id);
  }

  /**
   * Add an event directly to the store
   * Useful for events received outside the subscription system
   * (e.g., from Throttler, user actions, etc.)
   *
   * @param event - Event to add
   * @returns true if event was added, false if rejected/duplicate
   */
  addEvent(event: Event): boolean {
    return this.eventStore.addEvent(event);
  }

  /**
   * Fetch a single event (equivalent to pool.get)
   * Returns the first matching event or null. Result is stored in EventStore.
   *
   * @param relays - Relay URLs to query
   * @param filter - Nostr filter to match
   * @returns Promise resolving to the event or null
   */
  async fetchOne(relays: string[], filter: Filter): Promise<Event | null> {
    const results = await this.querySync(relays, { ...filter, limit: 1 });
    return results[0] || null;
  }

  /**
   * One-shot query (equivalent to pool.querySync)
   * Creates a subscription, collects events until EOSE, then closes.
   * Results are automatically stored in EventStore for future cache hits.
   *
   * @param relays - Relay URLs to query
   * @param filter - Single Nostr filter
   * @returns Promise resolving to array of matching events
   */
  async querySync(relays: string[], filter: Filter): Promise<Event[]> {
    const collected: Event[] = [];
    const seen = new Set<string>();

    return new Promise((resolve) => {
      let handle: SubscriptionHandle;
      handle = this.subscriptionManager.subscribe(
        relays,
        [filter],
        (event) => {
          if (!seen.has(event.id)) {
            seen.add(event.id);
            collected.push(event);
          }
        },
        () => {
          handle.unsubscribe();
          resolve(collected);
        }
      );

      // Timeout fallback (8s) in case EOSE never arrives
      setTimeout(() => {
        handle.unsubscribe();
        resolve(collected);
      }, 8000);
    });
  }

  // -- Batched fetch state --
  private _batchQueue: {
    id: string;
    relays: string[];
    resolve: (event: Event | null) => void;
  }[] = [];
  private _batchTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Fetch a single event by ID, batching multiple calls into one relay query.
   * Calls made within a 50ms window are combined into a single querySync
   * with all requested IDs, drastically reducing relay round-trips.
   */
  fetchBatched(relays: string[], id: string): Promise<Event | null> {
    // Check cache first
    const cached = this.eventStore.getById(id);
    if (cached) return Promise.resolve(cached);

    return new Promise((resolve) => {
      this._batchQueue.push({ id, relays, resolve });

      if (!this._batchTimer) {
        this._batchTimer = setTimeout(() => {
          this._flushBatch();
        }, 50);
      }
    });
  }

  private _flushBatch() {
    const queue = this._batchQueue;
    this._batchQueue = [];
    this._batchTimer = null;

    if (queue.length === 0) return;

    const allRelays = new Set<string>();
    const idToResolvers = new Map<string, ((event: Event | null) => void)[]>();

    for (const item of queue) {
      for (const r of item.relays) allRelays.add(r);
      if (!idToResolvers.has(item.id)) idToResolvers.set(item.id, []);
      idToResolvers.get(item.id)!.push(item.resolve);
    }

    const ids = Array.from(idToResolvers.keys());
    // pending tracks IDs still waiting — resolved one-by-one as events arrive
    const pending = new Map(idToResolvers);
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      // Resolve any IDs that never arrived with null
      for (const resolvers of Array.from(pending.values())) {
        resolvers.forEach(r => r(null));
      }
      pending.clear();
      handle.unsubscribe();
    };

    // fetchBatched filters out cached IDs before queueing, so onEvent here
    // is always called asynchronously (no sync cache delivery to worry about).
    const handle = this.subscribe(
      Array.from(allRelays),
      [{ ids }],
      {
        onEvent: (event) => {
          const resolvers = pending.get(event.id);
          if (!resolvers) return;
          pending.delete(event.id);
          resolvers.forEach(r => r(event));
        },
        onEose: finish,
      }
    );

    // Fallback: resolve remaining with null after 8 s
    setTimeout(finish, 8000);
  }

  /**
   * Fetch a single event by ID with per-relay diagnostics.
   * Unlike fetchBatched, this subscribes to each relay individually so it can
   * report which relays confirmed a miss (EOSE) vs which timed out.
   *
   * @param relays - Relay URLs to query
   * @param id     - Event ID to look for
   * @returns Diagnostic result including the event (or null) and per-relay info
   */
  async fetchWithDiagnostics(
    relays: string[],
    id: string
  ): Promise<import('./types').FetchDiagnostics> {
    // Cache hit — return immediately with empty diagnostics
    const cached = this.eventStore.getById(id);
    if (cached) {
      return { event: cached, relayResults: [], durationMs: 0 };
    }

    const startTime = Date.now();
    // Build result entries up-front so index is stable even after early finish
    const relayResults: import('./types').RelayFetchResult[] = relays.map((r) => ({
      relay: r,
      eosed: false,
    }));
    let foundEvent: Event | null = null;
    let done = false;
    // Track open Relay connections so we can close them on finish
    const openRelays: Relay[] = [];

    return new Promise((resolve) => {
      const finish = () => {
        if (done) return;
        done = true;
        for (const r of openRelays) {
          try { r.close(); } catch { /* already closed */ }
        }
        resolve({ event: foundEvent, relayResults, durationMs: Date.now() - startTime });
      };

      // Count how many relays still haven't replied (event or EOSE).
      // When it hits zero we're done.
      let pending = relays.length;
      if (pending === 0) { finish(); return; }

      const oneDone = () => { if (--pending <= 0) finish(); };

      relayResults.forEach((entry, i) => {
        const url = relays[i];

        // Guard so a single relay can only decrement `pending` once. A relay
        // that sends EOSE and *then* closes (or errors after connecting) would
        // otherwise call oneDone() twice, dropping pending to zero prematurely
        // and finishing before other relays — including the one holding the
        // event — have answered. That double-count was a source of intermittent
        // "couldn't load" failures.
        let settled = false;
        const relayDone = (eosed: boolean) => {
          if (settled) return;
          settled = true;
          if (eosed) entry.eosed = true;
          oneDone();
        };

        // Each relay gets its own independent connection so oneose is
        // unambiguously scoped to that single relay (SimplePool batches
        // EOSE across relays and fires too early for diagnostic purposes).
        Relay.connect(url)
          .then((relay) => {
            if (done) { relay.close(); return; }
            openRelays.push(relay);

            relay.subscribe([{ ids: [id] }], {
              onevent(event) {
                if (event.id === id && !foundEvent) {
                  foundEvent = event;
                  finish();
                }
              },
              // This relay definitively has no match — it sent EOSE.
              oneose() { relayDone(true); },
              // Relay closed before sending EOSE (connection dropped, auth
              // required, etc.) — a non-response, not a confirmed miss.
              onclose() { relayDone(false); },
            });
          })
          .catch(() => {
            // Could not connect at all — count as non-response.
            relayDone(false);
          });
      });

      // Hard timeout: resolve after 10 s regardless of how many relays replied
      setTimeout(finish, 10000);
    });
  }

  /**
   * Batch add multiple events
   * More efficient than calling addEvent multiple times
   *
   * @param events - Events to add
   * @returns Number of events successfully added
   */
  addEvents(events: Event[]): number {
    let addedCount = 0;
    for (const event of events) {
      if (this.eventStore.addEvent(event)) {
        addedCount++;
      }
    }
    return addedCount;
  }

  /**
   * Debug interface for inspecting runtime state
   */
  debug = {
    /**
     * Get runtime statistics
     */
    getStats: (): RuntimeStats => {
      const storeStats = this.eventStore.getStats();
      const subscriptionCount = this.subscriptionManager.getActiveCount();

      // Estimate memory usage (rough approximation)
      const avgEventSize = 1000; // bytes
      const estimatedMemory = storeStats.totalEvents * avgEventSize;

      return {
        totalEvents: storeStats.totalEvents,
        eventsByKind: storeStats.eventsByKind,
        activeSubscriptions: subscriptionCount,
        totalAuthors: storeStats.totalAuthors,
        estimatedMemory,
      };
    },

    /**
     * List all active subscriptions
     */
    listSubscriptions: (): SubscriptionDebugInfo[] => {
      return this.subscriptionManager.listSubscriptions();
    },

    /**
     * Get all events of a specific kind
     */
    getEventsByKind: (kind: number): Event[] => {
      return this.eventStore.getEventsByKind(kind);
    },

    /**
     * Clear all events (use with caution!)
     */
    clearEvents: (): void => {
      this.eventStore.clear();
    },

    /**
     * Prune old events
     */
    pruneOldEvents: (maxAgeDays: number = 7): number => {
      return this.eventStore.pruneOldEvents(maxAgeDays);
    },
  };

  /**
   * Get all relay URLs that currently have at least one active subscription.
   * Any relay appearing here is treated as "connected" in the health indicator.
   */
  getActiveRelays(): Set<string> {
    return this.subscriptionManager.getActiveRelays();
  }

  /**
   * Reconnect all active subscriptions.
   * Call after the app returns from background/idle to refresh stale connections.
   */
  reconnect(): void {
    this.subscriptionManager.reconnectAll();
  }

  /**
   * Whether a relay's underlying WebSocket is currently usable. Treats a
   * CONNECTING or OPEN socket as healthy; a missing relay object, missing
   * socket, or CLOSING/CLOSED socket as dead.
   */
  private isRelayHealthy(url: string): boolean {
    const normalized = poolNormalizeUrl(url);
    if (!normalized) return true; // can't assess — don't trigger churn
    const poolRelays = (this.pool as any).relays as Map<string, any>;
    const relay = poolRelays.get(normalized);
    if (!relay || !relay.ws) return false;
    // WebSocket.CONNECTING = 0, OPEN = 1, CLOSING = 2, CLOSED = 3
    return relay.ws.readyState === 0 || relay.ws.readyState === 1;
  }

  /**
   * Reconnect all subscriptions only when EVERY relay backing an active
   * subscription is unhealthy — i.e. a genuine total connectivity loss
   * (sleep/wake, network drop). Driven by the watchdog interval so a
   * long-lived tab recovers without user interaction.
   *
   * We deliberately do NOT reconnect when only *some* relays are unhealthy.
   * Under the gossip model a feed subscribes across many relays and, in
   * Nostr, it's normal for a few to be slow, unreachable, or idle-closed at
   * any given moment. Reconnecting globally on a single bad relay caused a
   * reconnect storm every 30s that tore down in-flight fetches and left feeds
   * stuck in their retry state. As long as one relay is alive, data flows, so
   * we leave the connections alone.
   */
  checkConnectionHealth(): void {
    const active = this.subscriptionManager.getActiveRelays();
    if (active.size === 0) return;
    const anyHealthy = Array.from(active).some((url) => this.isRelayHealthy(url));
    if (!anyHealthy) {
      this.reconnect();
    }
  }

  /**
   * Publish an event, automatically evicting dead relay connections first.
   * Use this instead of pool.publish() directly to avoid WebSocket errors.
   * Returns the same per-relay promise array as pool.publish().
   */
  publish(relays: string[], event: Event): Promise<string>[] {
    this.cleanStaleRelays(relays);
    return this.pool.publish(relays, event);
  }

  /**
   * Force-close and remove specific relays from the pool so the next
   * connection attempt (subscribe or publish) creates a fresh WebSocket.
   *
   * Use this when a relay fails with a WebSocket error — pool.close() alone
   * is not enough because it leaves the stale relay object in pool.relays,
   * and ensureRelay() will reuse it (with a resolved-but-dead connectionPromise).
   */
  forceResetRelays(relays: string[]): void {
    this.pool.close(relays);
    const poolRelays = (this.pool as any).relays as Map<string, unknown>;
    const normalizedTargets = new Set(relays.map(poolNormalizeUrl).filter(Boolean));
    for (const key of Array.from(poolRelays.keys())) {
      if (normalizedTargets.has(key)) poolRelays.delete(key);
    }
  }

  /**
   * Proactively evict relay objects whose WebSocket is CLOSING or CLOSED.
   *
   * Call this before pool.publish() to prevent "websocket error" failures.
   * The problem: when a subscription ends, nostr-tools calls relay.close(),
   * which sets _connected=false and closes the WebSocket — but does NOT clear
   * connectionPromise (the onclose handler skips cleanup because _connected is
   * already false). So ensureRelay() returns the dead relay, thinking it's
   * connected, and the next send() throws a WebSocket error.
   *
   * By deleting dead relays from the map first, ensureRelay() creates a fresh
   * relay object with a new WebSocket.
   */
  cleanStaleRelays(relays: string[]): void {
    const poolRelays = (this.pool as any).relays as Map<string, any>;
    const stale: string[] = [];
    for (const url of relays) {
      const normalized = poolNormalizeUrl(url);
      if (!normalized) continue;
      const relay = poolRelays.get(normalized);
      if (!relay) continue;
      const ws = relay.ws;
      // WebSocket.CLOSING = 2, WebSocket.CLOSED = 3
      if (ws && (ws.readyState === 2 || ws.readyState === 3)) {
        stale.push(url);
      }
    }
    if (stale.length > 0) {
      this.forceResetRelays(stale);
    }
  }


  /**
   * Cleanup - close all subscriptions and clear store
   * Useful for testing or app shutdown
   */
  cleanup(): void {
    this.subscriptionManager.closeAll();
    this.eventStore.clear();
  }
}

/**
 * Create a NostrRuntime instance
 * Typically called once to create a singleton
 */
export function createNostrRuntime(pool: SimplePool): NostrRuntime {
  return new NostrRuntime(pool);
}

// Re-export types for convenience
export * from './types';
export { EventStore } from './EventStore';
export { SubscriptionManager } from './SubscriptionManager';

