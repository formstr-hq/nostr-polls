/**
 * Envelope types for the Worker boundary. The payload is literal NIP-01
 * (`ClientMessage`/`RelayMessage`) so RelayCore stays reusable behind a real
 * WebSocket; control frames (account switch, NIP-42 sign RPC) ride alongside in
 * a tagged envelope so they never collide with NIP-01 messages.
 */
import type { EventTemplate } from "nostr-tools";
import type { Event } from "../core/types";
import type { ClientMessage, RelayMessage } from "../core/protocol";

/** Main thread → Worker. */
export type ToWorker =
  | { kind: "nostr"; msg: ClientMessage }
  | { kind: "setAccount"; pubkey: string | null }
  | { kind: "setUserRelays"; relays: string[] }
  | { kind: "signResult"; reqId: string; event: Event | null };

/** Worker → main thread. */
export type FromWorker =
  | { kind: "nostr"; msg: RelayMessage }
  | { kind: "signRequest"; reqId: string; template: EventTemplate }
  | { kind: "ready" };

export type { ClientMessage, RelayMessage };
