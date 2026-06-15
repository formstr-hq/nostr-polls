import { useState, useRef, useCallback, useEffect } from "react";
import { Event, Filter } from "nostr-tools";
import { useRelays } from "../../../../hooks/useRelays";
import { nostrRuntime } from "../../../../singletons";
import { useUserContext } from "../../../../hooks/useUserContext";
import { getRelaysForAuthors, prefetchOutboxRelays } from "../../../../nostr/OutboxService";

const FETCH_TIMEOUT_MS = 8000;

export const useFollowingNotes = () => {
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [version, setVersion] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const missingNotesRef = useRef<Set<string>>(new Set());
  const initialLoadDoneRef = useRef(false);
  const oldestEventTimestampRef = useRef<number | null>(null);
  const loadingRef = useRef(false);
  // A fetch that times out keeps its subscription open so late-arriving events
  // (slow/flaky relays) still stream in. We hold the handle here to tear it
  // down on the next fetch or on unmount.
  const activeHandleRef = useRef<{ unsubscribe: () => void } | null>(null);

  const { relays } = useRelays();
  const { user } = useUserContext();

  const notes = useCallback(() => {
    if (!user?.follows?.length) return new Map<string, Event>();
    const events = nostrRuntime.query({
      kinds: [1],
      authors: Array.from(user.follows),
    });
    const noteMap = new Map<string, Event>();
    for (const event of events) noteMap.set(event.id, event);
    return noteMap;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.follows, version]);

  const reposts = useCallback(() => {
    if (!user?.follows?.length) return new Map<string, Event[]>();
    const events = nostrRuntime.query({
      kinds: [6],
      authors: Array.from(user.follows),
    });
    const repostMap = new Map<string, Event[]>();
    for (const event of events) {
      const originalNoteId = event.tags.find((t) => t[0] === "e")?.[1];
      if (originalNoteId) {
        const existing = repostMap.get(originalNoteId) || [];
        if (!existing.find((e) => e.id === event.id)) {
          repostMap.set(originalNoteId, [...existing, event]);
        }
      }
    }
    return repostMap;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.follows, version]);

  // Check for newer notes — non-destructive, adds to pendingCount
  const checkForNewer = useCallback(() => {
    if (!initialLoadDoneRef.current || !user?.follows?.length || !relays?.length) return;
    const authors = Array.from(user.follows!);
    const currentEvents = nostrRuntime.query({ kinds: [1], authors });
    if (!currentEvents.length) return;
    const since = Math.max(...currentEvents.map((e) => e.created_at));
    const gossipRelays = getRelaysForAuthors(relays, authors);
    const handle = nostrRuntime.subscribe(
      gossipRelays,
      [{ kinds: [1], authors, since: since + 1, limit: 20 }],
      {
        onEvent: () => setPendingCount((c) => c + 1),
        onEose: () => handle.unsubscribe(),
      }
    );
  }, [user?.follows, relays]);

  // Retry initial load when user-specific relays arrive (NIP-65 fetch completes after
  // follows are loaded). First attempt uses defaultRelays; this catches the race where
  // those relays didn't have the events but user-specific relays do.
  useEffect(() => {
    if (!user?.follows?.length || !relays?.length || initialLoadDoneRef.current || loadingRef.current) return;
    fetchNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relays]);

  // Poll for newer notes every 60s after initial load; buffer via pendingCount
  useEffect(() => {
    if (!user?.follows?.length || !relays?.length) return;
    const interval = setInterval(checkForNewer, 60_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.follows, relays]);

  const mergeNewNotes = useCallback(() => {
    setVersion((v) => v + 1);
    setPendingCount(0);
  }, []);

  // Fetch the original notes for any reposts in one shot, no polling loop
  const startMissingNotesFetcher = useCallback(() => {
    const idsToFetch = Array.from(missingNotesRef.current);
    missingNotesRef.current.clear();
    if (!idsToFetch.length || !relays?.length) return;

    const authors = user?.follows ? Array.from(user.follows) : [];
    const gossipRelays = authors.length > 0 ? getRelaysForAuthors(relays, authors) : relays;

    nostrRuntime
      .querySync(gossipRelays, { kinds: [1], ids: idsToFetch })
      .then((events) => {
        if (events.length > 0) setVersion((v) => v + 1);
      });
  }, [relays, user?.follows]);

  // Load older notes (pagination down) or initial load
  const fetchNotes = useCallback(async (fresh?: boolean) => {
    if (!user?.follows?.length) {
      // User has no follows yet — nothing to fetch, mark as done so the spinner clears
      setInitialLoadDone(true);
      return;
    }
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadFailed(false);
    if (fresh) setRefreshing(true); else setLoadingMore(true);
    // Close any previous subscription we kept open after a timeout so fetches
    // don't stack up.
    activeHandleRef.current?.unsubscribe();
    activeHandleRef.current = null;
    const authors = Array.from(user.follows);

    prefetchOutboxRelays(authors); // fire-and-forget, populates cache for gossip model
    const gossipRelays = getRelaysForAuthors(relays, authors);

    const now = Math.floor(Date.now() / 1000);
    const noteFilter: Filter = { kinds: [1], authors, limit: 30 };
    if (fresh || oldestEventTimestampRef.current === null) {
      // Initial load or refresh: fetch last 24h
      noteFilter.since = now - 86400;
    } else {
      // Pagination: go backwards from oldest event this feed has seen
      noteFilter.until = oldestEventTimestampRef.current;
    }

    const repostFilter: Filter = { kinds: [6], authors, limit: 30 };
    if (fresh || oldestEventTimestampRef.current === null) {
      repostFilter.since = now - 86400;
    } else {
      repostFilter.until = oldestEventTimestampRef.current;
    }

    const deletionFilter: Filter = { kinds: [5], authors };
    if (fresh || oldestEventTimestampRef.current === null) {
      deletionFilter.since = now - 86400;
    } else {
      deletionFilter.until = oldestEventTimestampRef.current;
    }

    let fetchDone = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    let renderDebounceId: ReturnType<typeof setTimeout> | null = null;
    let eventCount = 0;
    let firstEventHandled = false;

    // Debounced version bump — coalesces bursts of events into a single re-render.
    const scheduleRender = () => {
      if (renderDebounceId) return;
      renderDebounceId = setTimeout(() => {
        renderDebounceId = null;
        setVersion((v) => v + 1);
      }, 200);
    };

    const finishFetch = (failed = false) => {
      if (fetchDone) return;
      fetchDone = true;
      clearTimeout(timeoutId);
      if (renderDebounceId) { clearTimeout(renderDebounceId); renderDebounceId = null; }
      loadingRef.current = false;
      setLoadingMore(false);
      setRefreshing(false);
      initialLoadDoneRef.current = true;
      setInitialLoadDone(true);
      // Only flag failed if zero events arrived — partial loads still render fine.
      if (failed && eventCount === 0) setLoadFailed(true);
    };

    const handle = nostrRuntime.subscribe(gossipRelays, [noteFilter, repostFilter, deletionFilter], {
      onEvent: (event: Event) => {
        eventCount++;
        if (event.kind === 6) {
          const originalNoteId = event.tags.find((t) => t[0] === "e")?.[1];
          if (originalNoteId) missingNotesRef.current.add(originalNoteId);
        }
        if (oldestEventTimestampRef.current === null || event.created_at < oldestEventTimestampRef.current) {
          oldestEventTimestampRef.current = event.created_at;
        }
        // First event: clear the spinner immediately and render synchronously.
        // Subsequent events: debounce so a burst doesn't thrash React.
        if (!firstEventHandled) {
          firstEventHandled = true;
          initialLoadDoneRef.current = true;
          setInitialLoadDone(true);
          // Events arrived (possibly after the timeout flagged a failure) —
          // clear the error so the empty/Retry state is replaced by notes.
          setLoadFailed(false);
          setVersion((v) => v + 1);
        } else {
          scheduleRender();
        }
      },
      onEose: () => {
        handle.unsubscribe();
        activeHandleRef.current = null;
        if (eventCount > 0) setVersion((v) => v + 1);
        startMissingNotesFetcher();
        finishFetch();
      },
      fresh,
    });

    activeHandleRef.current = handle;

    // On timeout, DON'T tear down the subscription. Under flaky connectivity
    // relays frequently connect after our 8s budget — keeping the sub open
    // lets those late events stream into the feed (matching how the
    // notifications subscription stays alive and back-fills). We only clear the
    // loading spinner here; finishFetch flags loadFailed when nothing has
    // arrived yet so the empty/Retry state shows, but the still-open
    // subscription replaces it with notes the moment events land. The handle is
    // closed on the next fetch, on EOSE, or on unmount.
    timeoutId = setTimeout(() => {
      finishFetch(true);
    }, FETCH_TIMEOUT_MS);
  }, [user?.follows, relays, startMissingNotesFetcher]);

  // Close any subscription kept open past a timeout when the hook unmounts.
  useEffect(() => {
    return () => {
      activeHandleRef.current?.unsubscribe();
      activeHandleRef.current = null;
    };
  }, []);

  const refreshNotes = useCallback(() => {
    initialLoadDoneRef.current = false;
    missingNotesRef.current.clear();
    oldestEventTimestampRef.current = null;
    setVersion(0);
    setPendingCount(0);
    setInitialLoadDone(false);
    setLoadFailed(false);
    fetchNotes(true);
  }, [fetchNotes]);

  return {
    notes: notes(),
    reposts: reposts(),
    fetchNotes,
    refreshNotes,
    checkForNewer,
    loadingMore,
    refreshing,
    loadFailed,
    pendingCount,
    mergeNewNotes,
    initialLoadDone,
  };
};
