import { useCallback, useMemo } from "react";
import { Event } from "nostr-tools";
import { useEvents } from "../../../../dataLayer/hooks";

/**
 * "Discover" feed — notes from the user's wider web-of-trust (the "network"
 * scope). A thin adapter over the data layer's `useEvents`: the worker (local
 * relay) resolves the web-of-trust authors from the DataLayerProvider's user,
 * owns the network, and assembles the feed. The `webOfTrust` arguments the old
 * API took are accepted-and-ignored for call-site compatibility.
 */
export const useDiscoverNotes = () => {
  const { items, newCount, showNew, loadOlder, loading } = useEvents({
    kinds: [1],
    scope: { type: "network" },
    includeNonRoots: true,
  });

  const notes = useMemo(() => {
    const m = new Map<string, Event>();
    for (const e of items) if (e.kind === 1) m.set(e.id, e);
    return m;
  }, [items]);

  const fetchNotes = useCallback((_wot?: Set<string>, _fresh?: boolean) => loadOlder(), [loadOlder]);
  const refreshNotes = useCallback((_wot?: Set<string>) => showNew(), [showNew]);
  const checkForNewer = useCallback(() => {}, []);

  return {
    notes,
    pendingCount: newCount,
    loadingMore: loading,
    refreshing: false,
    fetchNotes,
    refreshNotes,
    checkForNewer,
    mergeNewNotes: showNew,
  };
};
