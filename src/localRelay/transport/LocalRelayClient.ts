/**
 * LocalRelayClient — the main-thread handle to the Worker relay. Relay/pool-
 * shaped API (subscribe / query / publish) that the data-layer facade and the
 * useEvents hook sit on. It owns subscription ids and routes incoming frames to
 * the right callbacks. It also answers the Worker's NIP-42 sign requests via an
 * injected signer (the SignerBridge).
 */
import type { Event, Filter } from "../core/types";
import type { EventTemplate } from "nostr-tools";
import { Channel } from "./channel";
import { FromWorker, ToWorker } from "./frames";

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
  private pendingPublishes = new Map<string, (ok: boolean) => void>();
  private counter = 0;

  constructor(private channel: Channel, private opts: LocalRelayClientOptions = {}) {
    channel.onMessage((m) => this.onMessage(m as FromWorker));
  }

  /** Reactive subscription: replays cached matches, EOSE, then live updates. */
  subscribe(filters: Filter[], handlers: SubscribeHandlers): { id: string; unsubscribe: () => void } {
    const id = `c${this.counter++}`;
    this.subs.set(id, { handlers });
    this.send({ kind: "nostr", msg: ["REQ", id, ...filters] });
    return { id, unsubscribe: () => this.unsubscribe(id) };
  }

  unsubscribe(id: string): void {
    if (!this.subs.delete(id)) return;
    this.send({ kind: "nostr", msg: ["CLOSE", id] });
  }

  /** One-shot read: collect cached + streamed matches until EOSE, then close. */
  query(filters: Filter[] | Filter): Promise<Event[]> {
    const list = Array.isArray(filters) ? filters : [filters];
    return new Promise((resolve) => {
      const collected: Event[] = [];
      const { id } = this.subscribe(list, {
        onEvent: (e) => collected.push(e),
        onEose: () => {
          this.unsubscribe(id);
          resolve(collected);
        },
      });
    });
  }

  /** Publish an already-signed event; resolves with the relay's OK result. */
  publish(event: Event): Promise<boolean> {
    return new Promise((resolve) => {
      this.pendingPublishes.set(event.id, resolve);
      this.send({ kind: "nostr", msg: ["EVENT", event] });
    });
  }

  setActiveAccount(pubkey: string | null): void {
    this.send({ kind: "setAccount", pubkey });
  }

  /** Tell the worker which relays the user reads from (sync fallback + targets). */
  setUserRelays(relays: string[]): void {
    this.send({ kind: "setUserRelays", relays });
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
        case "OK": {
          const resolve = this.pendingPublishes.get(msg[1]);
          if (resolve) {
            this.pendingPublishes.delete(msg[1]);
            resolve(msg[2]);
          }
          break;
        }
        // NOTICE: ignored.
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
