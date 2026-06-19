/**
 * Envelope types for the Worker boundary. The payload is literal NIP-01
 * (`ClientMessage`/`RelayMessage`) so RelayCore stays reusable behind a real
 * WebSocket; control frames (account switch, NIP-42 sign RPC) ride alongside in
 * a tagged envelope so they never collide with NIP-01 messages.
 */
import type { EventTemplate } from "nostr-tools";
import type { Event } from "../core/types";
import type { ClientMessage, RelayMessage } from "../core/protocol";
import type { RelayPublishOutcome, RelayHealth } from "../sync/RelayPool";

import type { Filter } from "../core/types";

/** Main thread → Worker. */
export type ToWorker =
  | { kind: "nostr"; msg: ClientMessage }
  | { kind: "setAccount"; pubkey: string | null }
  | { kind: "setUserRelays"; relays: string[] }
  | { kind: "signResult"; reqId: string; event: Event | null }
  // --- publish with diagnostics ---
  /**
   * Publish a signed event: store locally AND send upstream, tracking each
   * relay's outcome. `relays` overrides the default outbox∪user routing (used by
   * retry to hit specific relays). Worker replies with a `publishResult`.
   */
  | { kind: "publish"; pubId: string; event: Event; relays?: string[] }
  /** Drop + rebuild specific relay connections (force-reset before a retry). */
  | { kind: "resetRelays"; relays: string[] }
  /** Request the live connection health of the user's relays. */
  | { kind: "relayHealth"; reqId: string }
  // --- upstream sync (decoupled from local REQs) ---
  /** Maintain a deduped, long-lived upstream subscription for a scope. */
  | { kind: "startSync"; key: string; filters: Filter[] }
  | { kind: "stopSync"; key: string }
  /** One-shot bounded backfill (pagination / ad-hoc); ingests, then closes. */
  | { kind: "fetchPage"; filters: Filter[] }
  // --- lifecycle ---
  /** App backgrounded/suspended: close all sockets, keep the store + sync specs. */
  | { kind: "pause" }
  /** App foregrounded: reconnect syncs + bounded catch-up. */
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
