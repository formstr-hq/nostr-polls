/**
 * NIP-01 wire messages, used verbatim as the Worker boundary protocol (plus one
 * INGEST extension). Keeping these literal NIP-01 means RelayCore could later be
 * exposed over a real WebSocket with no logic changes (see design §6).
 */
import type { Event, Filter } from "nostr-tools";

/** Messages a client sends to the relay. */
export type ClientMessage =
  | ["REQ", string, ...Filter[]]
  | ["CLOSE", string]
  | ["EVENT", Event]
  /** Extension: batch-insert upstream events (no per-event OK, no echo). */
  | ["INGEST", Event[]];

/** Messages the relay sends back. */
export type RelayMessage =
  | ["EVENT", string, Event]
  | ["EOSE", string]
  | ["OK", string, boolean, string]
  | ["CLOSED", string, string]
  | ["NOTICE", string];

export type EmitFn = (msg: RelayMessage) => void;
