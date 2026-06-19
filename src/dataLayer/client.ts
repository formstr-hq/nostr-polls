/**
 * DataLayer — the thin, intent-based surface the UI talks to. It replaces
 * `nostrRuntime`: the app speaks in kinds + scope (via the hooks) and never sees
 * a relay. This class is the imperative core the hooks sit on; it wraps a
 * `LocalRelayClient` and a signer, and deliberately exposes nothing relay-shaped
 * beyond the local-reactive primitives.
 *
 * It is dependency-injected (client + sign), so the whole thing is testable in
 * jsdom over an in-memory channel — no Worker, no signerManager. The browser
 * wiring (spawn the worker, wire signerManager + lifecycle) lives in
 * `bootstrap.ts`.
 *
 * NOTE: there is intentionally no generic `query(filters)` — see the design doc
 * §9. Reads are reactive (`subscribe` / the hooks); the only imperative read is
 * the id-addressed `fetchById`, which is unambiguous (an event exists or not).
 */
import type { Event, Filter } from "../localRelay/core/types";
import type { EventTemplate } from "nostr-tools";
import { LocalRelayClient, SubscribeHandlers } from "../localRelay/transport/LocalRelayClient";
import type { RelayPublishOutcome, RelayHealth } from "../localRelay/transport/frames";

export type { RelayPublishOutcome, RelayHealth };

/**
 * Aggregate publish outcome — same shape `PublishDiagnosticModal` already
 * consumes (per-relay accepted/rejected/timeout/failed + a summary), so the
 * diagnostics UI works unchanged.
 */
export interface PublishResult {
  ok: boolean;
  accepted: number;
  total: number;
  relayResults: RelayPublishOutcome[];
}

function toPublishResult(relayResults: RelayPublishOutcome[]): PublishResult {
  const accepted = relayResults.filter((r) => r.status === "accepted").length;
  return { ok: accepted > 0, accepted, total: relayResults.length, relayResults };
}

export interface DataLayerDeps {
  client: LocalRelayClient;
  /** Sign a template into a full event (local/NIP-07/NIP-46 via signerManager). */
  sign: (template: EventTemplate) => Promise<Event>;
}

export class DataLayer {
  constructor(private deps: DataLayerDeps) {}

  /** Local reactive read: cached replay → EOSE → live tail. Touches no network. */
  subscribe(filters: Filter[], handlers: SubscribeHandlers): { id: string; unsubscribe: () => void } {
    return this.deps.client.subscribe(filters, handlers);
  }

  /**
   * Declare that a scope should be kept warm from upstream relays — decoupled
   * from `subscribe` and ref-counted by the worker, so presentation churn does
   * not multiply network load. Returns `{ unsync }`.
   */
  sync(filters: Filter[]): { unsync: () => void } {
    return this.deps.client.sync(filters);
  }

  /** One-shot bounded backfill (pagination); ingests upstream results, then closes. */
  fetchPage(filters: Filter[]): void {
    this.deps.client.fetchPage(filters);
  }

  /**
   * Resolve a single event by id — local store first, then a bounded upstream
   * fetch. Resolves `null` if nothing arrives before the deadline. The only
   * imperative read on the surface (reactive twin: `useEvent`).
   */
  fetchById(id: string, deadlineMs = 8000): Promise<Event | null> {
    return new Promise((resolve) => {
      const filters: Filter[] = [{ ids: [id], limit: 1 }];
      let settled = false;
      let fetched = false;
      let unsubscribe = () => {};
      let timer: ReturnType<typeof setTimeout>;
      const finish = (e: Event | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(e);
      };
      // Cached events replay BEFORE EOSE → resolve without ever touching the
      // network. Only a genuine miss (empty EOSE) triggers the bounded upstream
      // fetch, with the same subscription left open to catch the arrival.
      unsubscribe = this.deps.client.subscribe(filters, {
        onEvent: finish,
        onEose: () => {
          if (settled || fetched) return;
          fetched = true;
          this.deps.client.fetchPage(filters);
        },
      }).unsubscribe;
      timer = setTimeout(() => finish(null), deadlineMs);
    });
  }

  /**
   * Sign a template, store it locally (so local subs see it instantly), and send
   * it upstream — the one mutation entry point. Returns the signed event plus the
   * per-relay publish outcome that feeds the diagnostics modal.
   */
  async publish(
    template: EventTemplate
  ): Promise<{ event: Event; result: PublishResult }> {
    const event = await this.deps.sign(template);
    const outcomes = await this.deps.client.publish(event);
    return { event, result: toPublishResult(outcomes) };
  }

  /**
   * Re-send an already-signed event (publish-diagnostics "retry"). Pass the
   * specific relays to retry; omit to use default routing.
   */
  async republish(event: Event, relays?: string[]): Promise<PublishResult> {
    return toPublishResult(await this.deps.client.publish(event, relays));
  }

  /** Force-reset relay connections before retrying (clears stale sockets). */
  resetRelays(relays: string[]): void {
    this.deps.client.resetRelays(relays);
  }

  /** Live connection health of the user's relays (for a relay-health view). */
  relayHealth(): Promise<RelayHealth[]> {
    return this.deps.client.relayHealth();
  }

  /** Force a full reconnect of all upstream relays (drop sockets, re-sync). */
  reconnect(): void {
    this.deps.client.pause();
    this.deps.client.resume();
  }

  // ---------------------------------------------------------------------------
  // Imperative escape hatch for NON-React code (contexts, helpers, nip17, etc.).
  // Components should use the reactive hooks (useEvents/useEvent), not these.
  // The `relays` args are accepted for drop-in compatibility but ignored — the
  // worker owns relay routing (outbox).
  // ---------------------------------------------------------------------------

  /**
   * Watch events (cache + live + upstream) — the imperative form of `useEvents`,
   * a drop-in for the old `nostrRuntime.subscribe`. `localOnly` skips the network;
   * `fresh` forces an immediate upstream pull.
   */
  watch(
    _relays: string[],
    filters: Filter[],
    options: { onEvent?: (e: Event) => void; onEose?: () => void; localOnly?: boolean; fresh?: boolean } = {}
  ): { id: string; unsubscribe: () => void } {
    const sub = this.deps.client.subscribe(filters, {
      onEvent: options.onEvent ?? (() => {}),
      onEose: options.onEose,
    });
    if (options.localOnly) return sub; // cache-only, no upstream
    const warm = this.deps.client.sync(filters);
    if (options.fresh) this.deps.client.fetchPage(filters);
    return {
      id: sub.id,
      unsubscribe: () => {
        sub.unsubscribe();
        warm.unsync();
      },
    };
  }

  /** One-shot LOCAL snapshot (was the synchronous `nostrRuntime.query`; now async). */
  query(filter: Filter | Filter[]): Promise<Event[]> {
    return this.deps.client.query(filter);
  }

  /** One-shot read WITH a bounded upstream fetch (was `querySync`). */
  querySync(_relays: string[], filter: Filter): Promise<Event[]> {
    return this.deps.client.fetch([filter]);
  }

  /** First match from cache + a bounded upstream fetch (was `fetchOne`). */
  async fetchOne(_relays: string[], filter: Filter): Promise<Event | null> {
    const events = await this.deps.client.fetch([{ ...filter, limit: 1 }]);
    return events[0] ?? null;
  }

  /** Resolve one event by id from cache + upstream (was `fetchBatched`). */
  async fetchBatched(_relays: string[], id: string): Promise<Event | null> {
    const events = await this.deps.client.fetch([{ ids: [id], limit: 1 }]);
    return events[0] ?? null;
  }

  /** Local-store lookup by id (was the synchronous `nostrRuntime.get`; now async). */
  async get(id: string): Promise<Event | undefined> {
    const events = await this.deps.client.query([{ ids: [id], limit: 1 }]);
    return events[0];
  }

  /** Add an event to the local store (optimistic / received-out-of-band). */
  addEvent(event: Event): void {
    this.deps.client.ingest([event]);
  }

  /** Batch-add events to the local store. */
  addEvents(events: Event[]): void {
    this.deps.client.ingest(events);
  }

  /**
   * Publish an already-signed event and get per-relay outcomes (was
   * `nostrRuntime.publish`). Use `publish(template)` for the sign+publish flow.
   */
  publishEvent(event: Event, relays?: string[]): Promise<RelayPublishOutcome[]> {
    return this.deps.client.publish(event, relays);
  }

  /** Active-account change: retarget scope (does NOT rehydrate the shared store). */
  setActiveAccount(pubkey: string | null): void {
    this.deps.client.setActiveAccount(pubkey);
  }

  /** Relays the user reads from (upstream sync fallback + publish floor). */
  setUserRelays(relays: string[]): void {
    this.deps.client.setUserRelays(relays);
  }

  /** App backgrounded: worker closes all sockets, keeps the store + sync specs. */
  pause(): void {
    this.deps.client.pause();
  }

  /** App foregrounded: worker reconnects the syncs. */
  resume(): void {
    this.deps.client.resume();
  }
}

// ---- singleton accessor (bootstrap.ts sets it; the hooks read it) ----
let instance: DataLayer | null = null;

/** Install the process-wide DataLayer (browser bootstrap, or a fake in tests). */
export function setDataLayer(dl: DataLayer | null): void {
  instance = dl;
}

/** The bootstrapped DataLayer. Throws if accessed before bootstrap. */
export function getDataLayer(): DataLayer {
  if (!instance) {
    throw new Error("DataLayer not bootstrapped — call bootstrapDataLayer() at app start.");
  }
  return instance;
}

/**
 * Ambient handle for non-React code (contexts, helpers, nip17). Resolves the
 * bootstrapped singleton lazily per call, so `import { dataLayer }` works at
 * module scope. React components should prefer the hooks.
 */
export const dataLayer: DataLayer = new Proxy({} as DataLayer, {
  get(_target, prop) {
    const dl = getDataLayer();
    const value = (dl as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(dl) : value;
  },
});
