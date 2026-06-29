import { useCallback, useMemo } from "react";
import { Event } from "nostr-tools";
import { useEvents } from "../../../../dataLayer/hooks";

/**
 * "Following" feed — notes + reposts from the accounts the user follows.
 *
 * This is now a thin adapter over the data layer's `useEvents`. The worker
 * (local relay) owns the network: it resolves the "following" scope from the
 * DataLayerProvider's user (pubkey/follows), streams cache + live + its own
 * upstream sync, and assembles the feed. The app no longer drives relays, polls
 * for newer events, or queries a synchronous store — those responsibilities (and
 * the gossip/outbox routing this hook used to do) live in the worker.
 *
 * The return shape is preserved so the feed component is unchanged.
 */
export const useFollowingNotes = () => {
  const { items, newCount, showNew, loadOlder, loading } = useEvents({
    kinds: [1, 6],
    scope: { type: "following" },
    includeNonRoots: true,
  });

  // kind 1 notes, keyed by id. Includes notes that arrived directly in the feed
  // PLUS the originals embedded inside kind-6 reposts. NIP-18 stringifies the
  // reposted event into the repost's `content`; recovering it here is what lets a
  // repost of a note from someone you don't follow still render in the feed
  // (otherwise the original is absent and the repost is silently dropped).
  const notes = useMemo(() => {
    const m = new Map<string, Event>();
    for (const e of items) if (e.kind === 1) m.set(e.id, e);
    for (const e of items) {
      if (e.kind !== 6 || !e.content) continue;
      const originalId = e.tags.find((t) => t[0] === "e")?.[1];
      if (!originalId || m.has(originalId)) continue;
      try {
        const embedded = JSON.parse(e.content) as Event;
        if (embedded?.id === originalId && embedded.kind === 1) {
          m.set(originalId, embedded);
        }
      } catch {
        // malformed repost content — skip, the repost just won't have a body
      }
    }
    return m;
  }, [items]);

  // kind 6 reposts grouped under the original note id (e-tag)
  const reposts = useMemo(() => {
    const m = new Map<string, Event[]>();
    for (const e of items) {
      if (e.kind !== 6) continue;
      const originalId = e.tags.find((t) => t[0] === "e")?.[1];
      if (!originalId) continue;
      const existing = m.get(originalId) || [];
      if (!existing.some((x) => x.id === e.id)) m.set(originalId, [...existing, e]);
    }
    return m;
  }, [items]);

  // Pagination widens the worker's window; "fresh" refresh reveals buffered new
  // items. Live tail is automatic, so the old polling `checkForNewer` is a no-op.
  const fetchNotes = useCallback((_fresh?: boolean) => loadOlder(), [loadOlder]);
  const checkForNewer = useCallback(() => {}, []);

  return {
    notes,
    reposts,
    fetchNotes,
    refreshNotes: showNew,
    checkForNewer,
    loadingMore: false,
    refreshing: false,
    loadFailed: false,
    pendingCount: newCount,
    mergeNewNotes: showNew,
    initialLoadDone: !loading,
  };
};
