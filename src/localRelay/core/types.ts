/**
 * Core types for the local relay.
 *
 * This module is platform-free: it imports nothing but nostr-tools types and is
 * safe to run in a Worker, in Node (tests), or on the main thread. Nothing here
 * touches the network, the DOM, IndexedDB, or React.
 */
import type { Event, Filter } from "nostr-tools";

export type { Event, Filter };

/** Callback fired when the store changes. `type` distinguishes the cause. */
export type StoreChange =
  | { type: "add"; event: Event }
  | { type: "remove"; id: string };

export type StoreListener = (change: StoreChange) => void;

/** Statistics about the store — used for debug + prune decisions. */
export interface DBStats {
  totalEvents: number;
  eventsByKind: Record<number, number>;
  totalAuthors: number;
}

/**
 * Pruning policy. created_at-based TTLs are in SECONDS (matching Nostr
 * timestamps); the hard cap and cadence are counts/ms handled by the scheduler.
 *
 * `protectedKinds` are never pruned regardless of age — profiles, contacts,
 * relay lists, and replaceable lists are tiny and load-bearing.
 */
export interface PrunePolicy {
  /** Kinds never pruned by age or cap. */
  protectedKinds: Set<number>;
  /** Per-kind TTL in seconds. Falls back to `defaultTtlSeconds`. */
  ttlByKind: Map<number, number>;
  /** TTL for any non-protected kind without an explicit entry. */
  defaultTtlSeconds: number;
  /** Hard cap on total stored events; oldest non-protected evicted past this. */
  maxEvents: number;
}

/**
 * Default pruning policy (see docs/local-relay-design.md §7).
 * Protected: profiles (0), contacts (3), relay lists (10002), and the
 * 10000-series replaceable lists (mutes, bookmarks, interests, …).
 */
export function defaultPrunePolicy(): PrunePolicy {
  const DAY = 24 * 60 * 60;
  const protectedKinds = new Set<number>([0, 3, 10002]);
  // 10000–19999 are replaceable lists — protect the whole range.
  for (let k = 10000; k < 20000; k++) protectedKinds.add(k);

  const ttlByKind = new Map<number, number>([
    [30023, 30 * DAY], // long-form articles
    [1068, 30 * DAY], // polls
  ]);

  return {
    protectedKinds,
    ttlByKind,
    defaultTtlSeconds: 7 * DAY, // notes, reposts, reactions, responses
    maxEvents: 50_000,
  };
}
