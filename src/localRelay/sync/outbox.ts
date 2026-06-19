/**
 * Outbox routing — the actual fix for the "missing events / gaps" bug.
 *
 * Instead of sending one filter with ALL authors to a fixed set of relays (where
 * each relay's `limit` truncates a huge author set and merging relays of unequal
 * density punches holes), we PARTITION authors by their NIP-65 write relays:
 * each relay gets a filter containing only the authors that actually publish
 * there. A relay's limited response then covers a coherent author set, so far
 * less is dropped.
 *
 * Pure: the per-author write-relay lookup is injected, so this is unit-testable
 * with a plain map and has no network/storage/cache dependency.
 */

export interface PartitionOptions {
  /** Fan each author to at most this many of their write relays (redundancy vs load). */
  maxRelaysPerAuthor?: number;
  /** Cap on total relays in the plan (mobile WebViews limit concurrent sockets). */
  maxRelays?: number;
}

const DEFAULTS = { maxRelaysPerAuthor: 3, maxRelays: 20 };

/**
 * Build a relay → authors plan. Every input author is guaranteed to appear under
 * at least one relay (authors with no known outbox fall back to `userRelays`),
 * so no author is silently dropped.
 */
export function partitionAuthorsByRelay(
  authors: string[],
  userRelays: string[],
  getWriteRelays: (pubkey: string) => string[],
  options: PartitionOptions = {}
): Map<string, Set<string>> {
  const maxPerAuthor = options.maxRelaysPerAuthor ?? DEFAULTS.maxRelaysPerAuthor;
  const maxRelays = options.maxRelays ?? DEFAULTS.maxRelays;
  const uniqueAuthors = Array.from(new Set(authors));

  // 1. author -> candidate write relays (capped), and a global popularity score.
  const authorRelays = new Map<string, string[]>();
  const score = new Map<string, number>();
  for (const author of uniqueAuthors) {
    const relays = Array.from(new Set(getWriteRelays(author))).slice(0, maxPerAuthor);
    authorRelays.set(author, relays);
    for (const r of relays) score.set(r, (score.get(r) ?? 0) + 1);
  }

  // 2. Choose the relay set: user's own relays always included, plus the most
  //    popular outbox relays up to the cap.
  const chosen = new Set<string>(userRelays);
  const ranked = Array.from(score.entries()).sort((a, b) => b[1] - a[1]);
  for (const [relay] of ranked) {
    if (chosen.size >= maxRelays) break;
    chosen.add(relay);
  }

  // 3. Assign authors to their chosen write relays; fall back to userRelays for
  //    authors with no chosen relay (no outbox info, or all theirs were dropped).
  const plan = new Map<string, Set<string>>();
  const addTo = (relay: string, author: string) => {
    let set = plan.get(relay);
    if (!set) {
      set = new Set();
      plan.set(relay, set);
    }
    set.add(author);
  };

  for (const author of uniqueAuthors) {
    const relays = (authorRelays.get(author) ?? []).filter((r) => chosen.has(r));
    if (relays.length > 0) {
      for (const r of relays) addTo(r, author);
    } else {
      // Coverage guarantee: never drop an author.
      for (const r of userRelays) addTo(r, author);
    }
  }

  return plan;
}

/**
 * Flat relay list (user relays + most-popular outbox relays) for cases that
 * don't need per-relay author scoping — e.g. fetching profiles/relay-lists in
 * bulk. Mirrors the old OutboxService.getRelaysForAuthors.
 */
export function relaysForAuthors(
  authors: string[],
  userRelays: string[],
  getWriteRelays: (pubkey: string) => string[],
  maxExtra = DEFAULTS.maxRelays
): string[] {
  const userSet = new Set(userRelays);
  const score = new Map<string, number>();
  for (const author of Array.from(new Set(authors))) {
    for (const r of getWriteRelays(author)) {
      if (!userSet.has(r)) score.set(r, (score.get(r) ?? 0) + 1);
    }
  }
  const extra = Array.from(score.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxExtra)
    .map(([r]) => r);
  return [...userRelays, ...extra];
}
