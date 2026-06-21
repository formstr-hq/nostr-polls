import { Event } from "nostr-tools";

/**
 * Persistent cache of the user's own contact list (kind 3).
 *
 * The contact list is load-bearing: every following/network-scoped feed needs
 * `follows` (and the web of trust derived from it). Sourcing it only from the
 * worker store made the empty-feed bug recur whenever worker hydration lost the
 * race or IndexedDB got evicted. So we cache it aggressively in localStorage and
 * hydrate `user.follows` from here the instant a user is present — independent of
 * the worker — then let the standing kind-3 observe revalidate it.
 *
 * Keyed by pubkey (multi-account safe). Contact lists are public, so persisting
 * them across sessions/logout leaks nothing.
 */

const CONTACTS_KEY_PREFIX = "pollerama:contacts:";

export interface CachedContacts {
  /** Raw kind-3 event — kept so it can be re-ingested into the worker store. */
  event: Event;
  /** Parsed follow pubkeys, denormalized for instant feed input. */
  follows: string[];
}

export function readCachedContacts(pubkey: string): CachedContacts | null {
  try {
    const raw = localStorage.getItem(CONTACTS_KEY_PREFIX + pubkey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedContacts;
    // Guard against malformed/partial entries.
    if (!parsed?.event || !Array.isArray(parsed.follows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedContacts(pubkey: string, data: CachedContacts): void {
  try {
    localStorage.setItem(CONTACTS_KEY_PREFIX + pubkey, JSON.stringify(data));
  } catch {
    // localStorage full — ignore; the worker store remains the durable copy.
  }
}
