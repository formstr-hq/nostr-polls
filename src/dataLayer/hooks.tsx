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
import { getRelayRefresh, subscribeRelayRefresh, isRelayHydrated } from "./relayRefresh";

/**
 * Reactive read of the relay refresh signal — bumps when the worker can newly
 * serve cached data (post-hydration / after a restart). Feeds use it to
 * re-declare interests so a populated store actually paints. See `relayRefresh`.
 */
export function useRelayRefresh(): number {
  return React.useSyncExternalStore(subscribeRelayRefresh, getRelayRefresh);
}

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
  // Re-declare the interest when the worker can newly serve cached data, so a
  // feed that EOSE'd before hydration repaints from the now-populated store.
  const refresh = useRelayRefresh();

  const [items, setItems] = React.useState<Event[]>([]);
  const [newCount, setNewCount] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  // All events ever seen for this scope, and the buffer of newer-than-top ones.
  const allRef = React.useRef(new Map<string, Event>());
  const pendingRef = React.useRef(new Map<string, Event>());
  const eosedRef = React.useRef(false);
  const topRef = React.useRef(0); // created_at of the newest currently-displayed item
  const oldestRef = React.useRef(0); // created_at of the oldest currently-displayed item (pagination cursor)
  const handleRef = React.useRef<ObserveHandle | null>(null);

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
    oldestRef.current = assembled[assembled.length - 1]?.created_at ?? 0;
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
    oldestRef.current = 0;
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
    // The initial window is the "head": newest PAGE, no `until`, so it also
    // carries the live tail and feeds the new-items buffer. loadOlder appends an
    // older window beside it.
    const handle = dataLayer.observe(buildFilters(kinds, scope, user, { limit: PAGE }), {
      onEvent,
      onEose: () => {
        eosedRef.current = true;
        recompute();
        // A pre-hydration EOSE means the store was still loading, not actually
        // empty — stay in `loading` (the `refresh` dep re-runs this effect once
        // hydration completes) instead of flashing an empty/failed state.
        if (isRelayHydrated()) setLoading(false);
      },
    });
    handleRef.current = handle;

    return () => {
      handle.unobserve();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLayer, kindsKey, scopeKey, follows, wot, feedRootsOnly, refresh]);

  const showNew = React.useCallback(() => {
    pendingRef.current = new Map(); // events are already in allRef; just stop withholding
    setNewCount(0);
    recompute();
  }, [recompute]);

  const loadOlder = React.useCallback(() => {
    // Paginate with an `until` cursor rather than a growing `limit`. A growing
    // limit asks each relay for its newest-N, so once N passes the relay's
    // max-limit cap it returns the same set forever — older notes between the
    // newest window and whatever stale events the cache happens to hold are never
    // fetched, leaving a visible gap. An `until` window instead asks for the
    // newest PAGE events *older than* the oldest note on screen: it starts
    // exactly where the last page ended (until is inclusive) and is immune to the
    // cap. The head window (no `until`) is kept alongside so the live tail and the
    // new-items buffer keep working.
    const head = buildFilters(kinds, scope, user, { limit: PAGE });
    const older =
      oldestRef.current > 0
        ? buildFilters(kinds, scope, user, { until: oldestRef.current, limit: PAGE })
        : [];
    handleRef.current?.update([...head, ...older]);
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
  // A cache-only read that resolved (or missed) before hydration won't see the
  // hydrated event (bulkLoad suppresses emits); re-run on refresh to catch it.
  const refresh = useRelayRefresh();

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
  }, [id, dataLayer, refresh]);

  return event;
}
