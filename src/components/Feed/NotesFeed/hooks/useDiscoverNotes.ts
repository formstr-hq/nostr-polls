import { useState, useRef, useCallback, useEffect } from "react";
import { nostrRuntime } from "../../../../singletons";
import { useRelays } from "../../../../hooks/useRelays";
import { Filter } from "nostr-tools/lib/types";

const LOAD_TIMEOUT_MS = 5000;

export const useDiscoverNotes = () => {
    const { relays } = useRelays();
    const [version, setVersion] = useState(0);
    const [pendingCount, setPendingCount] = useState(0);
    const [loadingMore, setLoadingMore] = useState(false);
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);
    const subscriptionHandleRef = useRef<any>(null);
    const fetchedRef = useRef(false);
    const webOfTrustRef = useRef<Set<string>>(new Set());

    // Query runtime for notes (only re-queries when version bumps, i.e. when user merges)
    const notes = useCallback(() => {
        const events = nostrRuntime.query({ kinds: [1] });
        const noteMap = new Map<string, any>();
        for (const event of events) noteMap.set(event.id, event);
        return noteMap;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [version]);

    // Merge buffered notes into the displayed list
    const mergeNewNotes = useCallback(() => {
        setVersion((v) => v + 1);
        setPendingCount(0);
    }, []);

    // Poll for newer notes every 60s after initial load; buffer count rather than displaying immediately
    useEffect(() => {
        if (!initialLoadComplete || !relays?.length) return;

        const poll = () => {
            const authors = Array.from(webOfTrustRef.current);
            if (!authors.length) return;
            const currentEvents = nostrRuntime.query({ kinds: [1] });
            if (!currentEvents.length) return;
            const since = Math.max(...currentEvents.map((e: any) => e.created_at));
            const handle = nostrRuntime.subscribe(
                relays,
                [{ kinds: [1], authors, since: since + 1, limit: 20 }],
                {
                    onEvent: () => setPendingCount((c) => c + 1),
                    onEose: () => handle.unsubscribe(),
                }
            );
        };

        const interval = setInterval(poll, 60_000);
        return () => clearInterval(interval);
    }, [initialLoadComplete, relays]);

    const fetchNotes = useCallback((webOfTrust: Set<string>) => {
        if (!webOfTrust?.size || !relays?.length || fetchedRef.current) return;

        fetchedRef.current = true;
        webOfTrustRef.current = webOfTrust;

        if (subscriptionHandleRef.current) {
            subscriptionHandleRef.current.unsubscribe();
        }

        setLoadingMore(true);

        const filter: Filter = {
            kinds: [1],
            authors: Array.from(webOfTrust),
            limit: 20,
        };

        const handle = nostrRuntime.subscribe(relays, [filter], {
            onEvent: () => {
                // During initial load, bump version so items appear as they arrive
                setVersion((v) => v + 1);
            },
            onEose: () => {
                setLoadingMore(false);
                setInitialLoadComplete(true);
                handle.unsubscribe();
            },
        });

        subscriptionHandleRef.current = handle;

        const timeout = setTimeout(() => {
            setLoadingMore(false);
            setInitialLoadComplete(true);
        }, LOAD_TIMEOUT_MS);

        return () => {
            clearTimeout(timeout);
            if (subscriptionHandleRef.current) {
                subscriptionHandleRef.current.unsubscribe();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [relays]);

    return {
        notes: notes(),
        pendingCount,
        loadingMore,
        fetchNotes,
        mergeNewNotes,
    };
};
