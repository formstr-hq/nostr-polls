import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { nostrRuntime } from "../../../../singletons";
import { useRelays } from "../../../../hooks/useRelays";
import { Filter } from "nostr-tools/lib/types";

const LOAD_TIMEOUT_MS = 5000;

export const useDiscoverNotes = () => {
    const { relays } = useRelays();
    const [version, setVersion] = useState(0);
    const [loadingMore, setLoadingMore] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);
    const subscriptionHandleRef = useRef<any>(null);
    const loadingRef = useRef(false);
    const oldestTimestampRef = useRef<number | null>(null);
    const webOfTrustRef = useRef<Set<string>>(new Set());
    // Frozen snapshot of the note ids currently displayed. Anything in the store
    // that isn't in this set is "pending" — buffered regardless of where it
    // would sort (new notes aren't always newest; late-arriving notes land in
    // the middle). Merging adds the pending ids so they slot into place at once,
    // instead of popping in one-by-one and shifting scroll.
    const displayedIdsRef = useRef<Set<string>>(new Set());
    // Ids we already know about (displayed, or present in the store the moment
    // the feed first loaded). Only notes that arrive *after* that baseline count
    // as new — otherwise pre-existing cached notes would flash a "+N" on load.
    const knownIdsRef = useRef<Set<string>>(new Set());
    const readyRef = useRef(false);

    // Displayed map (ids in the snapshot) + pending count (ids not yet known).
    // Recomputed whenever `version` bumps.
    const { noteMap, pendingCount } = useMemo(() => {
        const authors = Array.from(webOfTrustRef.current);
        const map = new Map<string, any>();
        if (!authors.length) return { noteMap: map, pendingCount: 0 };
        const events = nostrRuntime.query({ kinds: [1], authors });
        let pending = 0;
        for (const event of events) {
            if (displayedIdsRef.current.has(event.id)) {
                map.set(event.id, event);
            } else if (readyRef.current && !knownIdsRef.current.has(event.id)) {
                // Arrived after the feed loaded → a genuinely new note.
                pending++;
            }
        }
        return { noteMap: map, pendingCount: pending };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [version]);

    // Reveal buffered notes: add every not-yet-known store id to the snapshot so
    // they appear in their natural sorted positions.
    const mergeNewNotes = useCallback(() => {
        const authors = Array.from(webOfTrustRef.current);
        if (authors.length) {
            for (const e of nostrRuntime.query({ kinds: [1], authors })) {
                if (!knownIdsRef.current.has(e.id)) {
                    displayedIdsRef.current.add(e.id);
                    knownIdsRef.current.add(e.id);
                }
            }
        }
        setVersion((v) => v + 1);
    }, []);

    // Pull newer notes into the store (they stay buffered — not added to the
    // snapshot) and trigger a recompute so the pending count reflects them.
    const checkForNewer = useCallback(() => {
        if (!initialLoadComplete || !relays?.length) return;
        const authors = Array.from(webOfTrustRef.current);
        if (!authors.length) return;
        const currentEvents = nostrRuntime.query({ kinds: [1] });
        if (!currentEvents.length) return;
        const since = Math.max(...currentEvents.map((e: any) => e.created_at));
        let received = 0;
        const handle = nostrRuntime.subscribe(
            relays,
            [{ kinds: [1], authors, since: since + 1, limit: 20 }],
            {
                onEvent: () => { received++; },
                onEose: () => {
                    if (received > 0) setVersion((v) => v + 1);
                    handle.unsubscribe();
                },
            }
        );
    }, [initialLoadComplete, relays]);

    // Poll for newer notes every 60s after initial load
    useEffect(() => {
        if (!initialLoadComplete || !relays?.length) return;
        const interval = setInterval(checkForNewer, 60_000);
        return () => clearInterval(interval);
    }, [initialLoadComplete, relays, checkForNewer]);

    const fetchNotes = useCallback((webOfTrust: Set<string>, fresh?: boolean) => {
        if (!webOfTrust?.size || !relays?.length) return;
        if (loadingRef.current) return;

        loadingRef.current = true;
        webOfTrustRef.current = webOfTrust;

        if (subscriptionHandleRef.current) {
            subscriptionHandleRef.current.unsubscribe();
        }

        if (fresh) {
            setRefreshing(true);
            oldestTimestampRef.current = null;
        } else {
            setLoadingMore(true);
        }

        const now = Math.floor(Date.now() / 1000);
        const filter: Filter = {
            kinds: [1],
            authors: Array.from(webOfTrust),
            limit: 30,
        };

        if (oldestTimestampRef.current !== null) {
            // Pagination: go backwards from oldest seen event
            filter.until = oldestTimestampRef.current;
        } else {
            // Initial or fresh load: fetch last 24h
            filter.since = now - 86400;
        }

        const deletionFilter: Filter = { kinds: [5], authors: Array.from(webOfTrust) };
        if (oldestTimestampRef.current !== null) {
            deletionFilter.until = oldestTimestampRef.current;
        } else {
            deletionFilter.since = now - 86400;
        }

        let eventCount = 0;
        let firstEventHandled = false;
        let renderDebounceId: ReturnType<typeof setTimeout> | null = null;

        const scheduleRender = () => {
            if (renderDebounceId) return;
            renderDebounceId = setTimeout(() => {
                renderDebounceId = null;
                setVersion((v) => v + 1);
            }, 200);
        };

        const handle = nostrRuntime.subscribe(relays, [filter, deletionFilter], {
            onEvent: (event: any) => {
                eventCount++;
                // User-driven fetch (initial/fresh/pagination): these notes are
                // meant to be on screen, so display them and mark them known.
                if (event.kind === 1) {
                    displayedIdsRef.current.add(event.id);
                    knownIdsRef.current.add(event.id);
                }
                if (oldestTimestampRef.current === null || event.created_at < oldestTimestampRef.current) {
                    oldestTimestampRef.current = event.created_at;
                }
                if (!firstEventHandled) {
                    firstEventHandled = true;
                    setInitialLoadComplete(true);
                    setVersion((v) => v + 1);
                } else {
                    scheduleRender();
                }
            },
            onEose: () => {
                if (renderDebounceId) { clearTimeout(renderDebounceId); renderDebounceId = null; }
                // Establish the "known" baseline on the first load: everything
                // already in the store is considered seen, so only later
                // arrivals count as new. (Guarded so pagination doesn't reset it.)
                if (!readyRef.current) {
                    const authors = Array.from(webOfTrustRef.current);
                    if (authors.length) {
                        for (const e of nostrRuntime.query({ kinds: [1], authors })) {
                            knownIdsRef.current.add(e.id);
                        }
                    }
                    readyRef.current = true;
                }
                if (eventCount > 0) setVersion((v) => v + 1);
                setLoadingMore(false);
                setRefreshing(false);
                setInitialLoadComplete(true);
                loadingRef.current = false;
                handle.unsubscribe();
            },
            fresh,
        });

        subscriptionHandleRef.current = handle;

        const timeout = setTimeout(() => {
            if (renderDebounceId) { clearTimeout(renderDebounceId); renderDebounceId = null; }
            setLoadingMore(false);
            setRefreshing(false);
            setInitialLoadComplete(true);
            loadingRef.current = false;
        }, LOAD_TIMEOUT_MS);

        return () => {
            clearTimeout(timeout);
            if (subscriptionHandleRef.current) {
                subscriptionHandleRef.current.unsubscribe();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [relays]);

    const refreshNotes = useCallback((webOfTrust: Set<string>) => {
        // Non-destructive refresh: keep the notes already on screen and pull
        // newer ones in the background. fetchNotes(fresh=true) whitelists each
        // newly arrived note id into the displayed snapshot, so they slot in
        // without blanking the feed or losing scroll position. We intentionally
        // do NOT clear displayedIdsRef/knownIdsRef — clearing them was what
        // emptied the feed on reload. The `refreshing` LinearProgress overlay is
        // the only visible signal that a refresh is in flight. (oldestTimestamp
        // is reset inside fetchNotes for the fresh path.)
        loadingRef.current = false;
        fetchNotes(webOfTrust, true);
    }, [fetchNotes]);

    return {
        notes: noteMap,
        pendingCount,
        loadingMore,
        refreshing,
        fetchNotes,
        refreshNotes,
        checkForNewer,
        mergeNewNotes,
    };
};
