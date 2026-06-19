/**
 * RelayCore — the NIP-01 engine of the local relay. Pure and transport-agnostic:
 * it consumes `ClientMessage`s and produces `RelayMessage`s via an injected
 * `emit`, so it can be driven by a Worker MessagePort in production or called
 * directly in tests. It owns an EventDB and a registry of live subscriptions.
 *
 * REQ semantics (NIP-01):
 *   1. replay stored matches (newest-first) as EVENT frames
 *   2. send EOSE
 *   3. keep the subscription live — future matching events stream as EVENTs
 *      until CLOSE
 *
 * Signature verification is intentionally NOT done here (keeps the core
 * crypto-free and fast). Upstream events are verified by the sync layer before
 * INGEST; published events arrive already signed from the UI.
 */
import type { Event } from "nostr-tools";
import { EventDB } from "./EventDB";
import { ClientMessage, EmitFn, RelayMessage } from "./protocol";
import { matchAnyFilter } from "./matchFilter";
import { isEphemeralEvent, isValidEventStructure } from "./eventValidation";
import type { Filter } from "./types";

interface LiveSub {
  filters: Filter[];
  /** ids already delivered to this sub, so re-broadcasts don't duplicate. */
  seen: Set<string>;
}

export class RelayCore {
  private subs = new Map<string, LiveSub>();
  private detachStore: () => void;

  constructor(private db: EventDB, private emit: EmitFn) {
    // Fan stored additions out to matching live subscriptions.
    this.detachStore = db.onChange((change) => {
      if (change.type !== "add") return;
      this.fanOut(change.event);
    });
  }

  /** Dispatch a single client message. */
  handle(msg: ClientMessage): void {
    switch (msg[0]) {
      case "REQ":
        this.onReq(msg[1], msg.slice(2) as Filter[]);
        break;
      case "CLOSE":
        this.subs.delete(msg[1]);
        break;
      case "EVENT":
        this.onEvent(msg[1]);
        break;
      case "INGEST":
        this.onIngest(msg[1]);
        break;
    }
  }

  private onReq(subId: string, filters: Filter[]): void {
    const seen = new Set<string>();
    // Replay stored matches. Query per-filter (each may carry its own limit),
    // dedup across filters by id, emit newest-first overall.
    const collected = new Map<string, Event>();
    for (const filter of filters) {
      for (const event of this.db.query(filter)) collected.set(event.id, event);
    }
    const ordered = Array.from(collected.values()).sort(
      (a, b) => b.created_at - a.created_at
    );
    for (const event of ordered) {
      seen.add(event.id);
      this.emit(["EVENT", subId, event]);
    }
    this.emit(["EOSE", subId]);
    // Register as live AFTER replay (single-threaded: no event can slip in
    // between the query above and this registration).
    this.subs.set(subId, { filters, seen });
  }

  /** A published (signed) event. Store + OK + fan-out. */
  private onEvent(event: Event): void {
    if (!isValidEventStructure(event)) {
      this.emit(["OK", (event as any)?.id ?? "", false, "invalid: malformed event"]);
      return;
    }
    const stored = this.db.add(event);
    this.emit(["OK", event.id, true, stored ? "" : "duplicate:"]);
    // add() fans out stored events via onChange; ephemeral/duplicates don't, so
    // deliver ephemerals to live subs explicitly.
    if (!stored && isEphemeralEvent(event.kind)) this.fanOut(event);
  }

  /** Batch ingest from the sync engine: store quietly, fan-out, no OK. */
  private onIngest(events: Event[]): void {
    for (const event of events) {
      if (!isValidEventStructure(event)) continue;
      const stored = this.db.add(event);
      if (!stored && isEphemeralEvent(event.kind)) this.fanOut(event);
    }
  }

  /** Deliver an event to every live sub whose filters match (once each). */
  private fanOut(event: Event): void {
    for (const [subId, sub] of Array.from(this.subs.entries())) {
      if (sub.seen.has(event.id)) continue;
      if (!matchAnyFilter(event, sub.filters)) continue;
      sub.seen.add(event.id);
      this.emit(["EVENT", subId, event]);
    }
  }

  activeSubscriptionCount(): number {
    return this.subs.size;
  }

  dispose(): void {
    this.detachStore();
    this.subs.clear();
  }
}

export type { ClientMessage, RelayMessage };
