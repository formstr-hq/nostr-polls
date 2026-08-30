import { ReactNode, createContext, useRef, useState, useMemo, useCallback, useEffect } from "react";
import { Event } from "nostr-tools/lib/types/core";
import { Profile } from "../nostr/types";
import { dataLayer, type Filter, type ObserveHandle } from "@formstr/local-relay";

type AppContextInterface = {
  profiles: Map<string, Profile>;
  commentsMap: Map<string, Event[]>;
  editsMap: Map<string, Event>;
  editsHistoryMap: Map<string, Event[]>;
  likesMap: Map<string, Event[]>;
  zapsMap: Map<string, Event[]>;
  repostsMap: Map<string, Event[]>;
  // NIP-51 bookmark lists (kind 10003), indexed by both tag spellings they
  // may carry: event ids (`e`) and addressable a-refs. A count of distinct
  // authors bookmarking one event comes from here.
  bookmarksMap: Map<string, Event[]>;
  getBookmarkCount: (eventRef: string) => number;
  getProfile: (pubkey: string) => Profile | undefined;
  getComments: (eventId: string) => Event[];
  getLikes: (eventId: string) => Event[];
  getZaps: (eventId: string) => Event[];
  getReposts: (eventId: string) => Event[];
  addEventToProfiles: (event: Event) => void;
  addEventToMap: (event: Event) => void;
  removeEventFromMap: (eventId: string) => void;
  fetchUserProfileThrottled: (pubkey: string) => void;
  fetchCommentsThrottled: (pollEventId: string) => void;
  fetchEditsThrottled: (eventId: string) => void;
  fetchLikesThrottled: (pollEventId: string) => void;
  fetchZapsThrottled: (pollEventId: string) => void;
  fetchRepostsThrottled: (pollEventId: string) => void;
  fetchBookmarkCountThrottled: (eventRef: string) => void;
  aiSettings: {
    model: string;
  };
  setAISettings: (settings: { model: string }) => void;
  resetStore: () => void;
};

export const AppContext = createContext<AppContextInterface | null>(null);

/**
 * A standing interest keyed by a growing id set. Adding an id (re-)declares the
 * interest with a wider filter; the worker (local relay) owns the network and
 * decides if/when to fetch. Events stream back through `onEvent`. This replaces
 * the old per-kind Throttlers — the app never batches or drives connections.
 */
interface Interest {
  ids: Set<string>;
  handle: ObserveHandle | null;
  timer: ReturnType<typeof setTimeout> | null;
}
const newInterest = (): Interest => ({ ids: new Set(), handle: null, timer: null });

// How long a bookmark-count ref stays fetched before the interest re-arms for
// it — keeps the author-less kind-10003 count queries from re-firing on every
// feed scroll while still going live again eventually.
const BOOKMARK_COUNT_TTL_MS = 5 * 60 * 1000;

export function AppContextProvider({ children }: { children: ReactNode }) {
  const [aiSettings, setAISettings] = useState(
    JSON.parse(localStorage.getItem("ai-settings") || "{}"),
  );

  // Separate version counters so profile updates don't invalidate reaction maps and vice-versa
  const [profilesVersion, setProfilesVersion] = useState(0);
  const [dataVersion, setDataVersion] = useState(0);

  // The app-local view assembled from the interests we declare + optimistic
  // inserts. (The worker store is the network source of truth; this is what the
  // maps below are built from.)
  const eventsRef = useRef<Map<string, Event>>(new Map());
  // Locally-deleted event ids (NIP-09). Filtered out of every derived view so an
  // optimistic removal (e.g. undoing a reaction) sticks even if the worker
  // re-streams the same event before the delete propagates.
  const deletedEventIds = useRef<Set<string>>(new Set());

  // Debounce timers — coalesce rapid per-event bumps into a single re-render
  const profilesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const badProfileEvents = useRef<Set<string>>(new Set());

  const bumpProfilesVersion = useCallback(() => {
    if (profilesTimerRef.current) clearTimeout(profilesTimerRef.current);
    profilesTimerRef.current = setTimeout(() => setProfilesVersion((v) => v + 1), 50);
  }, []);

  const bumpDataVersion = useCallback(() => {
    if (dataTimerRef.current) clearTimeout(dataTimerRef.current);
    dataTimerRef.current = setTimeout(() => setDataVersion((v) => v + 1), 50);
  }, []);

  const queryStore = useCallback((kinds: number[]): Event[] => {
    const out: Event[] = [];
    eventsRef.current.forEach((e) => {
      if (kinds.includes(e.kind) && !deletedEventIds.current.has(e.id)) out.push(e);
    });
    return out;
  }, []);

  const onProfileEvent = useCallback((event: Event) => {
    eventsRef.current.set(event.id, event);
    bumpProfilesVersion();
  }, [bumpProfilesVersion]);

  const onDataEvent = useCallback((event: Event) => {
    eventsRef.current.set(event.id, event);
    bumpDataVersion();
  }, [bumpDataVersion]);

  const resetStore = useCallback(() => {
    eventsRef.current.clear();
    setDataVersion((v) => v + 1);
    setProfilesVersion((v) => v + 1);
  }, []);

  // --- the six standing interests (profiles + engagement) -------------------
  const interests = useRef({
    profiles: newInterest(),
    comments: newInterest(),
    edits: newInterest(),
    likes: newInterest(),
    zaps: newInterest(),
    reposts: newInterest(),
    bookmarks: newInterest(),
  });
  // Last-fetch timestamps for bookmark-count refs (TTL enforcement).
  const bookmarkCountFetchedAt = useRef(new Map<string, number>());

  const addToInterest = useCallback(
    (
      interest: Interest,
      id: string,
      buildFilters: (ids: string[]) => Filter[],
      onEvent: (e: Event) => void,
    ) => {
      if (!id || interest.ids.has(id)) return;
      interest.ids.add(id);
      if (interest.timer) clearTimeout(interest.timer);
      interest.timer = setTimeout(() => {
        const filters = buildFilters(Array.from(interest.ids));
        if (interest.handle) interest.handle.update(filters);
        else interest.handle = dataLayer.observe(filters, { onEvent });
      }, 300);
    },
    [],
  );

  // Drop every standing interest when the provider unmounts.
  useEffect(() => {
    const live = interests.current;
    return () => {
      Object.values(live).forEach((i) => {
        if (i.timer) clearTimeout(i.timer);
        i.handle?.unobserve();
      });
    };
  }, []);

  const fetchUserProfileThrottled = useCallback(
    (pubkey: string) =>
      addToInterest(interests.current.profiles, pubkey, (ids) => [{ kinds: [0], authors: ids }], onProfileEvent),
    [addToInterest, onProfileEvent],
  );
  const fetchCommentsThrottled = useCallback(
    (eventId: string) =>
      addToInterest(
        interests.current.comments,
        eventId,
        (ids) => [{ kinds: [1, 1111], "#e": ids }, { kinds: [1111], "#a": ids }],
        onDataEvent,
      ),
    [addToInterest, onDataEvent],
  );
  const fetchEditsThrottled = useCallback(
    (eventId: string) =>
      addToInterest(interests.current.edits, eventId, (ids) => [{ kinds: [1010], "#e": ids }], onDataEvent),
    [addToInterest, onDataEvent],
  );
  const fetchLikesThrottled = useCallback(
    (eventId: string) =>
      addToInterest(interests.current.likes, eventId, (ids) => [{ kinds: [7], "#e": ids }], onDataEvent),
    [addToInterest, onDataEvent],
  );
  const fetchZapsThrottled = useCallback(
    (eventId: string) =>
      addToInterest(interests.current.zaps, eventId, (ids) => [{ kinds: [9735], "#e": ids }], onDataEvent),
    [addToInterest, onDataEvent],
  );
  const fetchRepostsThrottled = useCallback(
    (eventId: string) =>
      addToInterest(interests.current.reposts, eventId, (ids) => [{ kinds: [6, 16], "#e": ids }], onDataEvent),
    [addToInterest, onDataEvent],
  );
  // NIP-51: every user's bookmark list (kind 10003) carries the bookmarked
  // event as an `e` tag (plain events) or an addressable a-ref. The interest
  // holds both spellings of every ref so one author-less query pair finds the
  // bookmarkers; a TTL re-arms the interest periodically so live counts still
  // update without re-querying on every feed scroll.
  const fetchBookmarkCountThrottled = useCallback(
    (eventRef: string) => {
      const interest = interests.current.bookmarks;
      const now = Date.now();
      const stamp = bookmarkCountFetchedAt.current.get(eventRef);
      if (stamp && now - stamp < BOOKMARK_COUNT_TTL_MS && interest.ids.has(eventRef)) return;
      bookmarkCountFetchedAt.current.set(eventRef, now);
      addToInterest(
        interest,
        eventRef,
        (ids) => [
          // `e`-tag refs (notes, polls) and a-ref refs (addressable) in one go;
          // ids that don't match the shape simply match nothing in a filter.
          { kinds: [10003], "#e": ids },
          { kinds: [10003], "#a": ids },
        ],
        onDataEvent,
      );
    },
    [addToInterest, onDataEvent],
  );

  // --- optimistic inserts (also pushed to the worker store) -----------------
  const addEventToProfiles = useCallback((event: Event) => {
    eventsRef.current.set(event.id, event);
    dataLayer.addEvent(event as any);
    bumpProfilesVersion();
  }, [bumpProfilesVersion]);

  const addEventToMap = useCallback((event: Event) => {
    eventsRef.current.set(event.id, event);
    dataLayer.addEvent(event as any);
    bumpDataVersion();
  }, [bumpDataVersion]);

  // Optimistically drop an event from the local view (e.g. after publishing a
  // NIP-09 delete for it). Tracked in deletedEventIds so a re-stream can't
  // resurrect it within the session.
  const removeEventFromMap = useCallback((eventId: string) => {
    deletedEventIds.current.add(eventId);
    eventsRef.current.delete(eventId);
    bumpDataVersion();
  }, [bumpDataVersion]);

  // --- derived maps (assembled from the app-local view) ---------------------
  const profiles = useMemo(() => {
    const profileMap = new Map<string, Profile>();
    for (const event of queryStore([0])) {
      if (badProfileEvents.current.has(event.id)) continue;
      try {
        const content = JSON.parse(event.content);
        profileMap.set(event.pubkey, { ...content, event });
      } catch (e) {
        badProfileEvents.current.add(event.id);
        console.warn("Skipping malformed profile", event.pubkey);
      }
    }
    return profileMap;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profilesVersion]);

  const commentsMap = useMemo(() => {
    const map = new Map<string, Event[]>();
    const addToMap = (key: string, event: Event) => {
      const existing = map.get(key) || [];
      if (!existing.find((e) => e.id === event.id)) map.set(key, [...existing, event]);
    };
    // Kind 1: index by e-tag
    for (const event of queryStore([1])) {
      const eTag = event.tags.find((tag) => tag[0] === "e");
      if (eTag) addToMap(eTag[1], event);
    }
    // Kind 1111 (NIP-22): index by A/a-tag (addressable ref) AND E/e-tag (event id)
    for (const event of queryStore([1111])) {
      for (const tag of event.tags) {
        if (tag[0] === "A" || tag[0] === "a" || tag[0] === "E" || tag[0] === "e") {
          if (tag[1]) addToMap(tag[1], event);
        }
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  const { editsMap, editsHistoryMap } = useMemo(() => {
    const latest = new Map<string, Event>();
    const history = new Map<string, Event[]>();
    const kind1ByEventId = new Map<string, Event>();
    for (const e of queryStore([1])) kind1ByEventId.set(e.id, e);

    for (const event of queryStore([1010])) {
      const eTag = event.tags.find((t) => t[0] === "e");
      if (!eTag?.[1]) continue;
      const original = kind1ByEventId.get(eTag[1]);
      // NIP-41: only trust edits signed by the original author
      if (original && original.pubkey !== event.pubkey) continue;
      const existing = latest.get(eTag[1]);
      if (!existing || event.created_at > existing.created_at) latest.set(eTag[1], event);
      history.set(eTag[1], [...(history.get(eTag[1]) || []), event]);
    }
    Array.from(history.keys()).forEach((k) => {
      history.set(k, (history.get(k) || []).sort((a, b) => b.created_at - a.created_at));
    });
    return { editsMap: latest, editsHistoryMap: history };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  const byETag = useCallback(
    (kinds: number[]) => {
      const map = new Map<string, Event[]>();
      for (const event of queryStore(kinds)) {
        const eTag = event.tags.find((tag) => tag[0] === "e");
        if (eTag) {
          const targetId = eTag[1];
          map.set(targetId, [...(map.get(targetId) || []), event]);
        }
      }
      return map;
    },
    [queryStore],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const likesMap = useMemo(() => byETag([7]), [dataVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const zapsMap = useMemo(() => byETag([9735]), [dataVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const repostsMap = useMemo(() => byETag([6, 16]), [dataVersion]);

  // NIP-51 bookmark lists, indexed by every ref tag they carry — `e` tags
  // (plain events) and addressable a-refs alike. One event can appear in many
  // users' lists → array of 10003 events.
  const bookmarksMap = useMemo(() => {
    const map = new Map<string, Event[]>();
    for (const event of queryStore([10003])) {
      for (const tag of event.tags) {
        if ((tag[0] === "a" || tag[0] === "e") && tag[1]) {
          map.set(tag[1], [...(map.get(tag[1]) || []), event]);
        }
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  const getProfile = (pubkey: string): Profile | undefined => profiles.get(pubkey);
  const getComments = (eventId: string): Event[] => commentsMap.get(eventId) || [];
  const getLikes = (eventId: string): Event[] => likesMap.get(eventId) || [];
  const getZaps = (eventId: string): Event[] => zapsMap.get(eventId) || [];
  const getReposts = (eventId: string): Event[] => repostsMap.get(eventId) || [];
  // Distinct users who bookmarked the event ref.
  const getBookmarkCount = (eventRef: string): number =>
    new Set((bookmarksMap.get(eventRef) || []).map((e) => e.pubkey)).size;

  return (
    <AppContext.Provider
      value={{
        profiles,
        commentsMap,
        editsMap,
        editsHistoryMap,
        likesMap,
        zapsMap,
        repostsMap,
        bookmarksMap,
        getBookmarkCount,
        getProfile,
        getComments,
        getLikes,
        getZaps,
        getReposts,
        addEventToProfiles,
        addEventToMap,
        removeEventFromMap,
        fetchUserProfileThrottled,
        fetchCommentsThrottled,
        fetchEditsThrottled,
        fetchLikesThrottled,
        fetchZapsThrottled,
        fetchRepostsThrottled,
        fetchBookmarkCountThrottled,
        aiSettings,
        setAISettings,
        resetStore,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
