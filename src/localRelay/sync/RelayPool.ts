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

export type PublishStatus = "accepted" | "rejected" | "timeout" | "failed";

/** Per-relay outcome of a publish — the raw material for publish diagnostics. */
export interface RelayPublishOutcome {
  relay: string;
  status: PublishStatus;
  /** Relay's reason on rejection, or a friendly note on failure. */
  message?: string;
  /** Milliseconds from publish start to this relay's response (or deadline). */
  latencyMs: number;
}

/** A relay's live connection state, for a "health of your relays" view. */
export interface RelayHealth {
  relay: string;
  connected: boolean;
  connecting: boolean;
  reconnecting: boolean;
}

export interface PublishOptions {
  /** Called once with every relay's outcome (all responded, or deadline hit). */
  onResult?: (results: RelayPublishOutcome[]) => void;
  /** Max wait before unresponsive relays are marked timeout/failed. */
  timeoutMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}

interface PendingPublish {
  relays: string[];
  awaiting: Set<string>;
  results: Map<string, RelayPublishOutcome>;
  start: number;
  now: () => number;
  onResult: (results: RelayPublishOutcome[]) => void;
  deadline: ReturnType<typeof setTimeout>;
}

const DEFAULT_PUBLISH_TIMEOUT_MS = 5000;

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
  private publishes = new Map<string, PendingPublish>();
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

  /**
   * Publish to every relay. Fire-and-forget unless `onResult` is given, in which
   * case each relay's OK / rejection / timeout / unreachable outcome is collected
   * (keyed by event id, since NIP-01 OK references the event id) and reported
   * once — the source of truth for the publish-diagnostics UI.
   */
  publish(relays: string[], event: Event, options: PublishOptions = {}): void {
    const targets = Array.from(new Set(relays));
    for (const url of targets) this.connection(url).publish(event);

    if (!options.onResult || targets.length === 0) {
      options.onResult?.([]);
      return;
    }
    const now = options.now ?? Date.now;
    const pending: PendingPublish = {
      relays: targets,
      awaiting: new Set(targets),
      results: new Map(),
      start: now(),
      now,
      onResult: options.onResult,
      deadline: setTimeout(
        () => this.finishPublish(event.id),
        options.timeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS
      ),
    };
    // A second publish of the same id supersedes the first's tracking.
    this.publishes.set(event.id, pending);
  }

  /** Live connection state for a set of relays (health view). */
  relayHealth(relays?: string[]): RelayHealth[] {
    const urls = relays && relays.length ? Array.from(new Set(relays)) : Array.from(this.connections.keys());
    return urls.map((relay) => {
      const c = this.connections.get(relay);
      return {
        relay,
        connected: c?.connected ?? false,
        connecting: c?.connecting ?? false,
        reconnecting: c?.reconnecting ?? false,
      };
    });
  }

  /** Drop and forget connections so the next use builds a fresh socket. */
  resetRelays(relays: string[]): void {
    for (const url of relays) {
      const c = this.connections.get(url);
      if (!c) continue;
      c.destroy();
      this.connections.delete(url);
    }
  }

  closeAll(): void {
    for (const sub of Array.from(this.subs.values())) {
      if (sub.deadline) clearTimeout(sub.deadline);
    }
    this.subs.clear();
    for (const pub of Array.from(this.publishes.values())) clearTimeout(pub.deadline);
    this.publishes.clear();
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
        onOk: (eventId, ok, message) => this.onPublishOk(eventId, ok, message, url),
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

  /** A relay answered a publish with OK true/false. */
  private onPublishOk(eventId: string, ok: boolean, message: string, relay: string): void {
    const pub = this.publishes.get(eventId);
    if (!pub || !pub.awaiting.has(relay)) return;
    pub.awaiting.delete(relay);
    pub.results.set(relay, {
      relay,
      status: ok ? "accepted" : "rejected",
      message: message || undefined,
      latencyMs: pub.now() - pub.start,
    });
    if (pub.awaiting.size === 0) this.finishPublish(eventId);
  }

  /** Resolve a publish: fill unanswered relays (timeout vs unreachable), report once. */
  private finishPublish(eventId: string): void {
    const pub = this.publishes.get(eventId);
    if (!pub) return;
    clearTimeout(pub.deadline);
    for (const relay of Array.from(pub.awaiting)) {
      // Distinguish "relay accepted the socket but never answered" (timeout) from
      // "we couldn't even reach it" (failed) — both are actionable to the user.
      const connected = this.connections.get(relay)?.connected ?? false;
      pub.results.set(relay, {
        relay,
        status: connected ? "timeout" : "failed",
        message: connected ? undefined : "Relay unreachable",
        latencyMs: pub.now() - pub.start,
      });
    }
    this.publishes.delete(eventId);
    pub.onResult(pub.relays.map((r) => pub.results.get(r)!));
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
