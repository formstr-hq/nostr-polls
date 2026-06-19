/**
 * Envelope types for the Worker boundary.
 *
 * Architectural invariant (load-bearing): the main thread can only DECLARE
 * INTERESTS and PUBLISH. It has no verb that means "fetch / open / reconnect /
 * reset" — the worker owns every connection decision based on the union of
 * active interests and its own affordances. So presentation scales independently
 * of the network: registering/dropping interests is the only input, and the
 * worker decides if/when/how to touch relays.
 *
 * The FromWorker `nostr` payload is literal NIP-01 (`RelayMessage`) so the same
 * client code could front a real relay; control frames ride alongside in a
 * tagged envelope.
 */
import type { EventTemplate } from "nostr-tools";
import type { Event, Filter } from "../core/types";
import type { ClientMessage, RelayMessage } from "../core/protocol";
import type { RelayPublishOutcome, RelayHealth } from "../sync/RelayPool";

/** Main thread → Worker. Interests + publish + config/lifecycle only. */
export type ToWorker =
  // --- declarative interests (the ONLY way the app influences reads) ---
  /**
   * Register/replace a standing interest. The worker serves cache + live tail
   * for `subId`, and — unless `sync` is false — autonomously keeps the scope
   * warm from relays (it decides which/when). Re-sending the same `subId` with
   * a wider window is how pagination ("load older") works: still declarative.
   */
  | { kind: "observe"; subId: string; filters: Filter[]; sync: boolean }
  /** Drop a standing interest (worker reconciles its connections). */
  | { kind: "unobserve"; subId: string }
  // --- writes ---
  /** Publish a signed event; worker routes + tracks per-relay outcome. Retry =
   *  publish again (the worker, not the app, handles dead relays). */
  | { kind: "publish"; pubId: string; event: Event }
  /** Add events to the local store without publishing upstream (optimistic). */
  | { kind: "ingest"; events: Event[] }
  // --- config / observation / lifecycle (not network commands) ---
  | { kind: "setAccount"; pubkey: string | null }
  | { kind: "setUserRelays"; relays: string[] }
  | { kind: "signResult"; reqId: string; event: Event | null }
  | { kind: "relayHealth"; reqId: string }
  /** App backgrounded/foregrounded — a lifecycle hint; the worker decides what
   *  to do (it cannot observe page visibility itself). */
  | { kind: "pause" }
  | { kind: "resume" };

/** Worker → main thread. */
export type FromWorker =
  | { kind: "nostr"; msg: RelayMessage }
  | { kind: "signRequest"; reqId: string; template: EventTemplate }
  | { kind: "publishResult"; pubId: string; results: RelayPublishOutcome[] }
  | { kind: "relayHealth"; reqId: string; relays: RelayHealth[] }
  | { kind: "ready" };

export type { ClientMessage, RelayMessage };
export type { RelayPublishOutcome, RelayHealth };
