/**
 * DataLayer — the intent-only surface the UI talks to. It replaces `nostrRuntime`.
 *
 * Load-bearing invariant: the app can only DECLARE INTERESTS (`observe` /
 * `observeOnce`, and the `useEvents`/`useEvent` hooks built on them) and PUBLISH.
 * There is no `fetch`/`sync`/`reconnect`/`resetRelays` — nothing here can cause
 * the worker to open a connection on demand. The worker owns every connection
 * decision from the union of active interests, so presentation scales
 * independently of the network.
 *
 * Dependency-injected (client + sign), so it's testable in jsdom over an
 * in-memory channel. Browser wiring lives in `bootstrap.ts`.
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

export interface ObserveOptions {
  /** Pure store read — no network. The worker syncs upstream when false (default). */
  localOnly?: boolean;
}

export interface ObserveHandle {
  id: string;
  /** Re-declare this interest with new filters (e.g. a wider window for paging). */
  update: (filters: Filter[]) => void;
  unobserve: () => void;
}

export class DataLayer {
  constructor(private deps: DataLayerDeps) {}

  /**
   * Declare a standing interest: cache replay → EOSE → live tail via `handlers`,
   * and (unless `localOnly`) the worker autonomously keeps the scope warm. This
   * is the imperative form of `useEvents`, for non-React code (contexts). It does
   * NOT command a fetch — it states what the app cares about; the worker decides
   * the network. `update` re-declares with a wider window to paginate.
   */
  observe(filters: Filter[], handlers: SubscribeHandlers, options: ObserveOptions = {}): ObserveHandle {
    return this.deps.client.observe(filters, handlers, options);
  }

  /**
   * Resolve a single event by id — the one place a Promise is right, because an
   * id-addressed read has a real terminal state (the event exists, or after a
   * bounded look it doesn't). Composed entirely from `observe`: try the cache
   * (localOnly) first, and only on a miss declare a sync interest so the worker
   * fetches it. Resolves `null` if nothing arrives before the deadline. The
   * reactive twin is `useEvent`. Everything else is a streaming `observe`.
   */
  fetchById(id: string, deadlineMs = 8000): Promise<Event | null> {
    return this.resolveOne([{ ids: [id], limit: 1 }], deadlineMs);
  }

  /**
   * Resolve the current value of a REPLACEABLE event (profile/relay-list/etc.) —
   * also a legitimate Promise, because a replaceable (kind, pubkey) has one
   * current value, a real terminal state like an id read. Growing sets (notes,
   * reactions) are NOT this — those must be a streaming `observe`/`useEvents`.
   */
  fetchReplaceable(kind: number, pubkey: string, deadlineMs = 8000): Promise<Event | null> {
    return this.resolveOne([{ kinds: [kind], authors: [pubkey], limit: 1 }], deadlineMs);
  }

  /** Cache-first single-value resolve, composed entirely from `observe`. */
  private resolveOne(filters: Filter[], deadlineMs: number): Promise<Event | null> {
    return new Promise((resolve) => {
      let settled = false;
      let fetched = false;
      let handle: ObserveHandle;
      let timer: ReturnType<typeof setTimeout>;

      const finish = (e: Event | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        handle.unobserve();
        resolve(e);
      };
      const onMiss = () => {
        // Not in cache → declare a sync interest so the worker fetches it.
        if (settled || fetched) return;
        fetched = true;
        handle.unobserve();
        handle = this.deps.client.observe(filters, { onEvent: finish });
      };

      handle = this.deps.client.observe(filters, { onEvent: finish, onEose: onMiss }, { localOnly: true });
      timer = setTimeout(() => finish(null), deadlineMs);
    });
  }

  /**
   * Sign a template, store it locally (so local interests see it instantly), and
   * send it upstream — the one mutation entry point. Returns the signed event plus
   * the per-relay publish outcome that feeds the diagnostics modal. Retry is just
   * another `publishEvent` — the worker, not the app, reaches dead relays.
   */
  async publish(template: EventTemplate): Promise<{ event: Event; result: PublishResult }> {
    const event = await this.deps.sign(template);
    const outcomes = await this.deps.client.publish(event);
    return { event, result: toPublishResult(outcomes) };
  }

  /** Publish an already-signed event (used by nip17/lists + diagnostics retry). */
  async publishEvent(event: Event): Promise<PublishResult> {
    return toPublishResult(await this.deps.client.publish(event));
  }

  /** Add an event to the local store (optimistic / received out-of-band). No network. */
  addEvent(event: Event): void {
    this.deps.client.ingest([event]);
  }

  /** Batch-add events to the local store. No network. */
  addEvents(events: Event[]): void {
    this.deps.client.ingest(events);
  }

  /** Live connection health of the user's relays (read-only observation). */
  relayHealth(): Promise<RelayHealth[]> {
    return this.deps.client.relayHealth();
  }

  /** Active-account change: retarget scope (does NOT rehydrate the shared store). */
  setActiveAccount(pubkey: string | null): void {
    this.deps.client.setActiveAccount(pubkey);
  }

  /** Relays the user reads from — a routing-policy input, not a command. */
  setUserRelays(relays: string[]): void {
    this.deps.client.setUserRelays(relays);
  }

  /** App backgrounded — lifecycle hint; the worker decides what to do. */
  pause(): void {
    this.deps.client.pause();
  }

  /** App foregrounded. */
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
