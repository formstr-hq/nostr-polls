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
   * Sign a template, publish it, and ingest it locally — the one mutation entry
   * point. The worker stores it (so local subs see it instantly) AND sends it to
   * the author's write relays. Returns the signed event.
   */
  async publish(template: EventTemplate): Promise<Event> {
    const event = await this.deps.sign(template);
    void this.deps.client.publish(event);
    return event;
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
