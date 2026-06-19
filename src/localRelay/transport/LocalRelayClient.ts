/**
 * LocalRelayClient — the main-thread handle to the Worker relay.
 *
 * The API is deliberately interest-only: the app can DECLARE INTERESTS
 * (`observe` / `observeOnce`) and PUBLISH, and nothing else. There is no verb
 * that opens a connection, fetches, reconnects, or resets — the worker owns all
 * of that. This is what lets presentation scale independently of the network.
 *
 * It owns subscription ids, routes incoming frames to callbacks, and answers the
 * worker's NIP-42 sign requests via an injected signer.
 */
import type { Event, Filter } from "../core/types";
import type { EventTemplate } from "nostr-tools";
import { Channel } from "./channel";
import { FromWorker, ToWorker, RelayPublishOutcome, RelayHealth } from "./frames";

export interface SubscribeHandlers {
  onEvent: (event: Event) => void;
  onEose?: () => void;
}

export interface LocalRelayClientOptions {
  /** Signs NIP-42 AUTH (and any worker-initiated) templates. Returns null to refuse. */
  onSignRequest?: (template: EventTemplate) => Promise<Event | null>;
}

interface Sub {
  handlers: SubscribeHandlers;
}

export class LocalRelayClient {
  private subs = new Map<string, Sub>();
  private pendingPublishes = new Map<string, (results: RelayPublishOutcome[]) => void>();
  private pendingHealth = new Map<string, (relays: RelayHealth[]) => void>();
  private counter = 0;

  constructor(private channel: Channel, private opts: LocalRelayClientOptions = {}) {
    channel.onMessage((m) => this.onMessage(m as FromWorker));
  }

  /**
   * Declare a standing interest: the worker replays cache, EOSEs, then streams
   * live updates, and — unless `sync` is false — autonomously keeps the scope
   * warm from relays (its decision, not ours). Re-`observe` the same handle with
   * a wider window to paginate. `localOnly` (sync:false) is a pure store read
   * that triggers no network.
   */
  observe(
    filters: Filter[],
    handlers: SubscribeHandlers,
    options: { localOnly?: boolean } = {}
  ): { id: string; update: (filters: Filter[]) => void; unobserve: () => void } {
    const id = `c${this.counter++}`;
    const sync = !options.localOnly;
    this.subs.set(id, { handlers });
    this.send({ kind: "observe", subId: id, filters, sync });
    return {
      id,
      update: (next) => this.send({ kind: "observe", subId: id, filters: next, sync }),
      unobserve: () => this.unobserve(id),
    };
  }

  private unobserve(id: string): void {
    if (!this.subs.delete(id)) return;
    this.send({ kind: "unobserve", subId: id });
  }

  /** Add events to the local store without publishing upstream (optimistic/import). */
  ingest(events: Event[]): void {
    if (events.length) this.send({ kind: "ingest", events });
  }

  /**
   * Publish an already-signed event; resolves with each relay's outcome (for
   * publish diagnostics). Retry is just another publish — the worker, not the
   * app, decides how to reach dead relays.
   */
  publish(event: Event): Promise<RelayPublishOutcome[]> {
    const pubId = `p${this.counter++}`;
    return new Promise((resolve) => {
      this.pendingPublishes.set(pubId, resolve);
      this.send({ kind: "publish", pubId, event });
    });
  }

  /** Live connection health of the user's relays (read-only observation). */
  relayHealth(): Promise<RelayHealth[]> {
    const reqId = `h${this.counter++}`;
    return new Promise((resolve) => {
      this.pendingHealth.set(reqId, resolve);
      this.send({ kind: "relayHealth", reqId });
    });
  }

  setActiveAccount(pubkey: string | null): void {
    this.send({ kind: "setAccount", pubkey });
  }

  /** The user's configured relays — a routing-policy input, not a command. */
  setUserRelays(relays: string[]): void {
    this.send({ kind: "setUserRelays", relays });
  }

  /** App backgrounded — a lifecycle hint; the worker decides what to do. */
  pause(): void {
    this.send({ kind: "pause" });
  }

  /** App foregrounded. */
  resume(): void {
    this.send({ kind: "resume" });
  }

  private send(msg: ToWorker): void {
    this.channel.post(msg);
  }

  private onMessage(m: FromWorker): void {
    if (m.kind === "nostr") {
      const msg = m.msg;
      switch (msg[0]) {
        case "EVENT": {
          this.subs.get(msg[1])?.handlers.onEvent(msg[2]);
          break;
        }
        case "EOSE": {
          this.subs.get(msg[1])?.handlers.onEose?.();
          break;
        }
        case "CLOSED": {
          this.subs.get(msg[1])?.handlers.onEose?.();
          this.subs.delete(msg[1]);
          break;
        }
        // OK (local store ack) is not surfaced — publish resolves via publishResult.
        // NOTICE: ignored.
      }
      return;
    }

    if (m.kind === "publishResult") {
      const resolve = this.pendingPublishes.get(m.pubId);
      if (resolve) {
        this.pendingPublishes.delete(m.pubId);
        resolve(m.results);
      }
      return;
    }

    if (m.kind === "relayHealth") {
      const resolve = this.pendingHealth.get(m.reqId);
      if (resolve) {
        this.pendingHealth.delete(m.reqId);
        resolve(m.relays);
      }
      return;
    }

    if (m.kind === "signRequest") {
      const handler = this.opts.onSignRequest;
      Promise.resolve(handler ? handler(m.template) : null)
        .then((event) => this.send({ kind: "signResult", reqId: m.reqId, event }))
        .catch(() => this.send({ kind: "signResult", reqId: m.reqId, event: null }));
      return;
    }
    // "ready": no-op for now.
  }
}
