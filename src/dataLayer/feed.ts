/**
 * Feed assembly — turn a raw event snapshot (from the store) into an ordered,
 * de-duplicated display list. Centralizes the merge/dedupe/sort logic that each
 * feed used to hand-roll. Pure and testable.
 */
import type { Event } from "nostr-tools";
import { dedupeKey, isFeedRoot } from "./kinds";

export interface AssembleOptions {
  /** Drop non-root items (replies, reactions, reposts) — default true. */
  feedRootsOnly?: boolean;
}

export function assembleFeed(events: Event[], opts: AssembleOptions = {}): Event[] {
  const rootsOnly = opts.feedRootsOnly ?? true;
  const byKey = new Map<string, Event>();
  for (const e of events) {
    if (rootsOnly && !isFeedRoot(e)) continue;
    const key = dedupeKey(e);
    const existing = byKey.get(key);
    if (!existing || e.created_at > existing.created_at) byKey.set(key, e);
  }
  return Array.from(byKey.values()).sort((a, b) => b.created_at - a.created_at);
}
