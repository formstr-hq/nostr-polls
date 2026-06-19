/**
 * RelayPool — our own pool. We do NOT use nostr-tools SimplePool: it fires EOSE
 * on the FIRST relay's EOSE, which routinely reports "loaded" while most relays
 * are still streaming — a direct cause of missing events. This pool's contract:
 *
 *   A logical subscription's EOSE fires only when EVERY targeted relay has sent
 *   EOSE (or CLOSED, or the connection is unusable), OR an explicit deadline
 *   elapses — whichever comes first, and exactly once. One slow/dead relay can
 *   neither hang the feed nor fake completion.
 *
 * Also: events are de-duplicated by id across relays before delivery; the live
 * subscription stays open after EOSE (late/middle events keep flowing); per-relay
 * failures are isolated (a relay erroring/closing never breaks the others).
 *
 * Pure logic over the Socket interface (via RelayConnection) → tested end-to-end
 * with FakeSocket, no real network.
 */
import type { Event, Filter } from "../core/types";
import { SocketFactory, webSocketFactory } from "./Socket";
import {
  RelayConnection,
  RelayConnectionHandlers,
  RelayConnectionOptions,
} from "./RelayConnection";

export interface PoolSubscribeHandlers {
  onEvent: (event: Event, relay: string) => void;
  /** Fired once: all relays done, or the deadline elapsed. */
  onEose?: () => void;
}

export interface PoolSubscribeOptions {
  /** Max wait before forcing logical EOSE even if relays haven't all replied. */
  eoseDeadlineMs?: number;
}

interface LogicalSub {
  relays: string[];
  handlers: PoolSubscribeHandlers;
  seenEvents: Set<string>;
  doneRelays: Set<string>;
  eosed: boolean;
  deadline: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_EOSE_DEADLINE_MS = 8000;

export class RelayPool {
  private connections = new Map<string, RelayConnection>();
  private subs = new Map<string, LogicalSub>();
  private subCounter = 0;

  constructor(
    private factory: SocketFactory = webSocketFactory,
    private connOptions: RelayConnectionOptions = {}
  ) {}

  /**
   * Open a logical subscription across `relays`. Returns an id; call
   * `unsubscribe(id)` to close it on every relay. The subscription stays live
   * after EOSE until you unsubscribe.
   */
  subscribe(
    relays: string[],
    filters: Filter[],
    handlers: PoolSubscribeHandlers,
    options: PoolSubscribeOptions = {}
  ): string {
    const subId = `s${this.subCounter++}`;
    const targets = Array.from(new Set(relays));
    const sub: LogicalSub = {
      relays: targets,
      handlers,
      seenEvents: new Set(),
      doneRelays: new Set(),
      eosed: false,
      deadline: null,
    };
    this.subs.set(subId, sub);

    const deadlineMs = options.eoseDeadlineMs ?? DEFAULT_EOSE_DEADLINE_MS;
    sub.deadline = setTimeout(() => this.fireEose(subId), deadlineMs);

    for (const url of targets) this.connection(url).req(subId, filters);
    return subId;
  }

  unsubscribe(subId: string): void {
    const sub = this.subs.get(subId);
    if (!sub) return;
    if (sub.deadline) clearTimeout(sub.deadline);
    for (const url of sub.relays) this.connections.get(url)?.close(subId);
    this.subs.delete(subId);
  }

  /**
   * One-shot query: collect deduped events until the logical EOSE, then close.
   * This is the only mode that auto-closes on EOSE.
   */
  query(
    relays: string[],
    filter: Filter,
    options: PoolSubscribeOptions = {}
  ): Promise<Event[]> {
    return new Promise((resolve) => {
      const collected: Event[] = [];
      const id = this.subscribe(
        relays,
        [filter],
        {
          onEvent: (event) => collected.push(event),
          onEose: () => {
            this.unsubscribe(id);
            resolve(collected);
          },
        },
        options
      );
    });
  }

  /** Publish to every relay. (OK aggregation is added with the publish path.) */
  publish(relays: string[], event: Event): void {
    for (const url of Array.from(new Set(relays))) this.connection(url).publish(event);
  }

  closeAll(): void {
    for (const sub of Array.from(this.subs.values())) {
      if (sub.deadline) clearTimeout(sub.deadline);
    }
    this.subs.clear();
    for (const conn of Array.from(this.connections.values())) conn.destroy();
    this.connections.clear();
  }

  // --- internals ---

  private connection(url: string): RelayConnection {
    let conn = this.connections.get(url);
    if (!conn) {
      const handlers: RelayConnectionHandlers = {
        onEvent: (subId, event) => this.onEvent(subId, event, url),
        onEose: (subId) => this.markDone(subId, url),
        onClosed: (subId) => this.markDone(subId, url),
      };
      conn = new RelayConnection(url, this.factory, handlers, this.connOptions);
      this.connections.set(url, conn);
      conn.connect();
    }
    return conn;
  }

  private onEvent(subId: string, event: Event, relay: string): void {
    const sub = this.subs.get(subId);
    if (!sub) return;
    if (sub.seenEvents.has(event.id)) return; // cross-relay dedup
    sub.seenEvents.add(event.id);
    sub.handlers.onEvent(event, relay);
  }

  /** A relay finished (EOSE/CLOSED) for this sub. EOSE fires when all are done. */
  private markDone(subId: string, relay: string): void {
    const sub = this.subs.get(subId);
    if (!sub) return;
    sub.doneRelays.add(relay);
    if (sub.doneRelays.size >= sub.relays.length) this.fireEose(subId);
  }

  private fireEose(subId: string): void {
    const sub = this.subs.get(subId);
    if (!sub || sub.eosed) return;
    sub.eosed = true;
    if (sub.deadline) {
      clearTimeout(sub.deadline);
      sub.deadline = null;
    }
    sub.handlers.onEose?.();
  }
}
