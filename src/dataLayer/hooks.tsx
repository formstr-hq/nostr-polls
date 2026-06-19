/**
 * The UI-facing data layer: `useEvents` (reactive feed) and `useEvent` (reactive
 * single event). Components ask for **kinds + scope** and get an assembled,
 * deduped, newest-first list with pagination + a "new items" buffer — they never
 * build a filter or name a relay.
 *
 * How it maps to the worker relay:
 *   - `subscribe(baseFilters)` → cached replay + EOSE + live tail (no network).
 *   - `sync(syncFilters)`      → keep the scope warm upstream (deduped, ref-counted).
 *   - `fetchPage(window)`      → bounded older backfill on loadOlder().
 * Events ingested upstream flow back through the same local subscription.
 */
import React from "react";
import type { Event } from "../localRelay/core/types";
import { DataLayer, getDataLayer } from "./client";
import { Scope, ScopeUser, buildFilters, scopeHasInput } from "./scope";
import { assembleFeed } from "./feed";
import { isFeedRoot } from "./kinds";

const WARM_LIMIT = 200; // initial upstream window kept warm per scope
const PAGE_LIMIT = 100; // older backfill page size

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
    setItems([]);
    setNewCount(0);
    setLoading(true);

    if (!scopeHasInput(scope, user)) {
      setLoading(false);
      return; // nothing to show (e.g. logged out / empty follows)
    }

    const baseFilters = buildFilters(kinds, scope, user); // local: everything in store
    const warmFilters = buildFilters(kinds, scope, user, { limit: WARM_LIMIT }); // upstream

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

    const sub = dataLayer.subscribe(baseFilters, {
      onEvent,
      onEose: () => {
        eosedRef.current = true;
        recompute();
        setLoading(false);
      },
    });
    const warm = dataLayer.sync(warmFilters);

    return () => {
      sub.unsubscribe();
      warm.unsync();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLayer, kindsKey, scopeKey, follows, wot, feedRootsOnly]);

  const showNew = React.useCallback(() => {
    pendingRef.current = new Map(); // events are already in allRef; just stop withholding
    setNewCount(0);
    recompute();
  }, [recompute]);

  const loadOlder = React.useCallback(() => {
    const oldest = items[items.length - 1]?.created_at;
    const window = oldest ? { until: oldest - 1, limit: PAGE_LIMIT } : { limit: PAGE_LIMIT };
    const page = buildFilters(kinds, scope, user, window);
    if (page.length) dataLayer.fetchPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLayer, items, kindsKey, scopeKey, follows, wot]);

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
    const sub = dataLayer.subscribe([{ ids: [id], limit: 1 }], {
      onEvent: (e) => {
        if (alive) setEvent(e);
      },
    });
    dataLayer.fetchPage([{ ids: [id], limit: 1 }]); // pull from upstream if not cached
    return () => {
      alive = false;
      sub.unsubscribe();
    };
  }, [id, dataLayer]);

  return event;
}
