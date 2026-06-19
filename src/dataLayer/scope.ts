/**
 * Scope — the constrained "what to fetch" handle the UI passes to useEvents.
 * Kinds say *which* event types; scope says *which subset of the network*. The
 * data layer turns (kinds × scope) into filters and owns relay routing,
 * pagination, and dedup — the UI never builds a raw filter or sees a relay.
 */
import type { Filter } from "nostr-tools";

export type Scope =
  | { type: "following" }
  | { type: "network" }
  | { type: "author"; pubkey: string }
  | { type: "thread"; rootId: string }
  | { type: "mentions"; pubkey: string }
  | { type: "global" };

export interface ScopeUser {
  pubkey?: string;
  follows?: string[];
  webOfTrust?: Set<string>;
}

/** Time window for pagination (seconds). */
export interface Window {
  since?: number;
  until?: number;
  limit?: number;
}

/**
 * Authors for an author-scoped feed, or `null` when the scope isn't
 * author-based (thread/mentions/global use tags/nothing instead).
 */
export function resolveAuthors(scope: Scope, user: ScopeUser): string[] | null {
  switch (scope.type) {
    case "following":
      return user.follows ?? [];
    case "network":
      return user.webOfTrust ? Array.from(user.webOfTrust) : [];
    case "author":
      return [scope.pubkey];
    default:
      return null;
  }
}

/**
 * Build the NIP-01 filters for a feed. One filter carries all kinds + the
 * resolved author set (the data layer's SyncEngine partitions authors by outbox
 * downstream); thread/mentions use tag filters; global is author-less.
 */
export function buildFilters(
  kinds: number[],
  scope: Scope,
  user: ScopeUser,
  window: Window = {}
): Filter[] {
  const base: Filter = { kinds };
  if (window.since !== undefined) base.since = window.since;
  if (window.until !== undefined) base.until = window.until;
  if (window.limit !== undefined) base.limit = window.limit;

  switch (scope.type) {
    case "thread":
      // The root note plus its replies/quotes.
      return [
        { ...base, ids: [scope.rootId] },
        { ...base, "#e": [scope.rootId] } as Filter,
      ];
    case "mentions":
      return [{ ...base, "#p": [scope.pubkey] } as Filter];
    case "global":
      return [base];
    default: {
      const authors = resolveAuthors(scope, user) ?? [];
      // No authors (logged out / empty follows or network): nothing to fetch.
      if (authors.length === 0) return [];
      return [{ ...base, authors }];
    }
  }
}

/** True when the scope can produce a feed for this user (avoids empty queries). */
export function scopeHasInput(scope: Scope, user: ScopeUser): boolean {
  switch (scope.type) {
    case "following":
      return (user.follows?.length ?? 0) > 0;
    case "network":
      return (user.webOfTrust?.size ?? 0) > 0;
    default:
      return true;
  }
}
