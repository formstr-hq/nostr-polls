/**
 * The UI-facing data layer: `useEvents` (reactive feed) and `useEvent` (reactive
 * single event). Components ask for **kinds + scope** and get an assembled,
 * deduped, newest-first list with pagination + a "new items" buffer — they never
 * build a filter or name a relay.
 *
 * How it maps to the worker relay: each hook declares a single `observe`
 * interest (cache replay + live tail + the worker's autonomous upstream sync).
 * Pagination ("load older") just re-declares the same interest with a larger
 * window — still declarative; the worker decides if/when to fetch more. Nothing
 * here commands the network.
 */
import React from "react";
import {
  DataLayer,
  getDataLayer,
  buildFilters,
  scopeHasInput,
  assembleFeed,
  isFeedRoot,
  type Event,
  type ObserveHandle,
  type Scope,
  type ScopeUser,
} from "@formstr/local-relay";

const PAGE = 100; // window grows by this many events per "load older"

interface DataLayerContextValue {
  dataLayer: DataLayer;
  user: ScopeUser;
}

const DataLayerContext = React.createContext<DataLayerContextValue | null>(null);

/**
 * Provides the bootstrapped DataLayer + the current user's scope inputs
 * (pubkey / follows / web-of-trust) so author-scoped feeds can resolve. The app
 * supplies `user` from its existing user/WoT contexts.
 */
export function DataLayerProvider({
  user,
  dataLayer,
  children,
}: {
  user: ScopeUser;
  dataLayer?: DataLayer; // injectable for tests; defaults to the singleton
  children: React.ReactNode;
}) {
  const value = React.useMemo(
    () => ({ dataLayer: dataLayer ?? getDataLayer(), user }),
    [dataLayer, user]
  );
  return <DataLayerContext.Provider value={value}>{children}</DataLayerContext.Provider>;
}

function useDataLayerContext(): DataLayerContextValue {
  const ctx = React.useContext(DataLayerContext);
  if (!ctx) throw new Error("useEvents/useEvent must be used within a <DataLayerProvider>");
  return ctx;
}

export interface UseEventsOptions {
  kinds: number[];
  scope: Scope;
  /** Keep replies/reactions/reposts (default false → feed roots only). */
  includeNonRoots?: boolean;
}

export interface UseEventsResult {
  items: Event[];
  /** Newer events that arrived live but are held back from the list. */
  newCount: number;
  /** Reveal the buffered new events at the top of the list. */
  showNew: () => void;
  /** Fetch an older page (pagination). */
  loadOlder: () => void;
  /** True until the first local EOSE. */
  loading: boolean;
}

/**
 * Reactive feed for (kinds × scope). Returns an assembled list plus a live "new
 * items" buffer and pagination. Re-subscribes when kinds/scope/user change.
 */
export function useEvents({ kinds, scope, includeNonRoots }: UseEventsOptions): UseEventsResult {
  const { dataLayer, user } = useDataLayerContext();
  const feedRootsOnly = !includeNonRoots;

  const [items, setItems] = React.useState<Event[]>([]);
  const [newCount, setNewCount] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  // All events ever seen for this scope, and the buffer of newer-than-top ones.
  const allRef = React.useRef(new Map<string, Event>());
  const pendingRef = React.useRef(new Map<string, Event>());
  const eosedRef = React.useRef(false);
  const topRef = React.useRef(0); // created_at of the newest currently-displayed item
  const handleRef = React.useRef<ObserveHandle | null>(null);
  const limitRef = React.useRef(PAGE); // current window size (grows on loadOlder)

  // Stable key so the effect re-runs only on a real scope/kinds change.
  const kindsKey = kinds.join(",");
  const scopeKey = JSON.stringify(scope);
  const follows = user.follows?.join(",");
  const wot = user.webOfTrust ? user.webOfTrust.size : 0;

  const scheduledRef = React.useRef(false);

  const recompute = React.useCallback(() => {
    const pool: Event[] = [];
    allRef.current.forEach((e) => {
      if (!pendingRef.current.has(e.id)) pool.push(e);
    });
    const assembled = assembleFeed(pool, { feedRootsOnly });
    topRef.current = assembled[0]?.created_at ?? 0;
    setItems(assembled);
  }, [feedRootsOnly]);

  // Coalesce a burst of ingests into one assembly, so an initial batch arriving
  // across several store ticks is shown together rather than split across the
  // "new items" line (which keys off the displayed top).
  const scheduleRecompute = React.useCallback(() => {
    if (scheduledRef.current) return;
    scheduledRef.current = true;
    Promise.resolve().then(() => {
      scheduledRef.current = false;
      recompute();
    });
  }, [recompute]);

  React.useEffect(() => {
    // Reset accumulators for the new scope.
    allRef.current = new Map();
    pendingRef.current = new Map();
    eosedRef.current = false;
    topRef.current = 0;
    limitRef.current = PAGE;
    setItems([]);
    setNewCount(0);
    setLoading(true);

    if (!scopeHasInput(scope, user)) {
      setLoading(false);
      handleRef.current = null;
      return; // nothing to show (e.g. logged out / empty follows)
    }

    const onEvent = (e: Event) => {
      allRef.current.set(e.id, e);
      const isRoot = !feedRootsOnly || isFeedRoot(e);
      // Once the feed has content (topRef > 0), a newer root is buffered and
      // counted rather than shifting the list under the user; everything else
      // (initial fill, older backfill) merges in place.
      if (eosedRef.current && isRoot && topRef.current > 0 && e.created_at > topRef.current) {
        pendingRef.current.set(e.id, e);
        setNewCount(pendingRef.current.size);
      } else {
        scheduleRecompute();
      }
    };

    // One declarative interest: cache + live + the worker's autonomous sync.
    const handle = dataLayer.observe(buildFilters(kinds, scope, user, { limit: limitRef.current }), {
      onEvent,
      onEose: () => {
        eosedRef.current = true;
        recompute();
        setLoading(false);
      },
    });
    handleRef.current = handle;

    return () => {
      handle.unobserve();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLayer, kindsKey, scopeKey, follows, wot, feedRootsOnly]);

  const showNew = React.useCallback(() => {
    pendingRef.current = new Map(); // events are already in allRef; just stop withholding
    setNewCount(0);
    recompute();
  }, [recompute]);

  const loadOlder = React.useCallback(() => {
    // Widen the interest's window — declarative; the worker fetches more if it
    // sees fit. Re-replays cached matches (deduped) + extends the upstream sync.
    limitRef.current += PAGE;
    handleRef.current?.update(buildFilters(kinds, scope, user, { limit: limitRef.current }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindsKey, scopeKey, follows, wot]);

  return { items, newCount, showNew, loadOlder, loading };
}

/**
 * Reactive single event by id. Serves a cached hit, then a bounded upstream
 * fetch fills a cold miss (and the value updates if it arrives later).
 */
export function useEvent(id?: string): Event | undefined {
  const { dataLayer } = useDataLayerContext();
  const [event, setEvent] = React.useState<Event | undefined>(undefined);

  React.useEffect(() => {
    if (!id) {
      setEvent(undefined);
      return;
    }
    let alive = true;
    // Cache-only: a read never triggers a fetch. The event is in the store
    // because the worker enriched it for whatever scope referenced it; this
    // updates live if it lands later. (Reads can't cause network activity.)
    const handle = dataLayer.observe(
      [{ ids: [id], limit: 1 }],
      { onEvent: (e) => { if (alive) setEvent(e); } },
      { localOnly: true }
    );
    return () => {
      alive = false;
      handle.unobserve();
    };
  }, [id, dataLayer]);

  return event;
}
