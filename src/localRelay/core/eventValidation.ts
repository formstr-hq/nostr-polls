/**
 * Event classification helpers (NIP-01 replaceable/ephemeral semantics, NIP-09
 * deletion ordering). Pure functions, no platform deps.
 *
 * Ported from src/nostrRuntime/utils/eventValidation.ts — kept behaviourally
 * identical so the store's replacement/dedup rules don't regress on cutover.
 */
import type { Event } from "nostr-tools";

/**
 * Replaceable event kinds: 0 (metadata), 3 (contacts), 10000–19999
 * (replaceable lists), 30000–39999 (addressable / parameterized replaceable).
 * Only the latest per replaceable key is kept.
 */
export function isReplaceableEvent(kind: number): boolean {
  if (kind === 0 || kind === 3) return true;
  if (kind >= 10000 && kind < 20000) return true;
  if (kind >= 30000 && kind < 40000) return true;
  return false;
}

/** Ephemeral kinds (20000–29999) are never stored. */
export function isEphemeralEvent(kind: number): boolean {
  return kind >= 20000 && kind < 30000;
}

/**
 * Replaceable identity key. Addressable events (30000–39999) are keyed by
 * kind:pubkey:dTag; plain replaceable events by kind:pubkey.
 */
export function getReplaceableKey(event: Event): string {
  if (event.kind >= 30000 && event.kind < 40000) {
    const dTag = event.tags.find((tag) => tag[0] === "d");
    return `${event.kind}:${event.pubkey}:${dTag?.[1] ?? ""}`;
  }
  return `${event.kind}:${event.pubkey}`;
}

/**
 * Whether `candidate` should replace `existing` for the same replaceable key.
 * Newer created_at wins; ties broken by lexicographically larger id (NIP-01).
 */
export function shouldReplaceEvent(candidate: Event, existing: Event): boolean {
  if (candidate.created_at > existing.created_at) return true;
  if (candidate.created_at < existing.created_at) return false;
  return candidate.id > existing.id;
}

/** Shape validation only — signature verification happens in the sync layer. */
export function isValidEventStructure(event: any): event is Event {
  if (!event || typeof event !== "object") return false;
  if (typeof event.id !== "string") return false;
  if (typeof event.pubkey !== "string") return false;
  if (typeof event.created_at !== "number") return false;
  if (typeof event.kind !== "number") return false;
  if (!Array.isArray(event.tags)) return false;
  if (typeof event.content !== "string") return false;
  if (typeof event.sig !== "string") return false;
  return true;
}

/** True if a NIP-40 expiration tag puts the event in the past. */
export function isExpired(event: Event, nowSeconds: number): boolean {
  const exp = event.tags.find((t) => t[0] === "expiration")?.[1];
  if (!exp) return false;
  return nowSeconds > Number(exp);
}
