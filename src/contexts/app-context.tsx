import { ReactNode, createContext, useRef, useState, useMemo, useCallback, useEffect } from "react";
import { Event } from "nostr-tools/lib/types/core";
import { Profile } from "../nostr/types";
import { dataLayer, type Filter, type ObserveHandle } from "@formstr/local-relay";
import { getCachedProfiles, setCachedProfile } from "../utils/localStorage";

type AppContextInterface = {
  profiles: Map<string, Profile>;
  commentsMap: Map<string, Event[]>;
  editsMap: Map<string, Event>;
  editsHistoryMap: Map<string, Event[]>;
  likesMap: Map<string, Event[]>;
  zapsMap: Map<string, Event[]>;
  repostsMap: Map<string, Event[]>;
  getProfile: (pubkey: string) => Profile | undefined;
  getComments: (eventId: string) => Event[];
  getLikes: (eventId: string) => Event[];
  getZaps: (eventId: string) => Event[];
  getReposts: (eventId: string) => Event[];
  addEventToProfiles: (event: Event) => void;
  addEventToMap: (event: Event) => void;
  fetchUserProfileThrottled: (pubkey: string) => void;
  fetchCommentsThrottled: (pollEventId: string) => void;
  fetchEditsThrottled: (eventId: string) => void;
  fetchLikesThrottled: (pollEventId: string) => void;
  fetchZapsThrottled: (pollEventId: string) => void;
  fetchRepostsThrottled: (pollEventId: string) => void;
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
      if (kinds.includes(e.kind)) out.push(e);
    });
    return out;
  }, []);

  const onProfileEvent = useCallback((event: Event) => {
    eventsRef.current.set(event.id, event);
    if (event.kind === 0) setCachedProfile(event as any);
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

  // Seed from the localStorage profile cache on first mount so avatars/names are
  // available before any network responses arrive.
  useEffect(() => {
    const cached = getCachedProfiles();
    if (cached.length > 0) {
      for (const e of cached as Event[]) eventsRef.current.set(e.id, e);
      bumpProfilesVersion();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- the six standing interests (profiles + engagement) -------------------
  const interests = useRef({
    profiles: newInterest(),
    comments: newInterest(),
    edits: newInterest(),
    likes: newInterest(),
    zaps: newInterest(),
    reposts: newInterest(),
  });

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

  // --- optimistic inserts (also pushed to the worker store) -----------------
  const addEventToProfiles = useCallback((event: Event) => {
    eventsRef.current.set(event.id, event);
    dataLayer.addEvent(event as any);
    if (event.kind === 0) setCachedProfile(event as any);
    bumpProfilesVersion();
  }, [bumpProfilesVersion]);

  const addEventToMap = useCallback((event: Event) => {
    eventsRef.current.set(event.id, event);
    dataLayer.addEvent(event as any);
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

  const getProfile = (pubkey: string): Profile | undefined => profiles.get(pubkey);
  const getComments = (eventId: string): Event[] => commentsMap.get(eventId) || [];
  const getLikes = (eventId: string): Event[] => likesMap.get(eventId) || [];
  const getZaps = (eventId: string): Event[] => zapsMap.get(eventId) || [];
  const getReposts = (eventId: string): Event[] => repostsMap.get(eventId) || [];

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
        getProfile,
        getComments,
        getLikes,
        getZaps,
        getReposts,
        addEventToProfiles,
        addEventToMap,
        fetchUserProfileThrottled,
        fetchCommentsThrottled,
        fetchEditsThrottled,
        fetchLikesThrottled,
        fetchZapsThrottled,
        fetchRepostsThrottled,
        aiSettings,
        setAISettings,
        resetStore,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
