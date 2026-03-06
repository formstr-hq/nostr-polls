import { ReactNode, createContext, useRef, useState, useMemo, useCallback } from "react";
import { Event } from "nostr-tools/lib/types/core";
import { Profile } from "../nostr/types";
import { Throttler } from "../nostr/requestThrottler";
import { pool, nostrRuntime } from "../singletons";

type AppContextInterface = {
  profiles: Map<string, Profile>;
  commentsMap: Map<string, Event[]>;
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
  fetchLikesThrottled: (pollEventId: string) => void;
  fetchZapsThrottled: (pollEventId: string) => void;
  fetchRepostsThrottled: (pollEventId: string) => void;
  aiSettings: {
    model: string;
  };
  setAISettings: (settings: { model: string }) => void;
};

export const AppContext = createContext<AppContextInterface | null>(null);

export function AppContextProvider({ children }: { children: ReactNode }) {
  const [aiSettings, setAISettings] = useState(
    JSON.parse(localStorage.getItem("ai-settings") || "{}"),
  );

  // Separate version counters so profile updates don't invalidate reaction maps and vice-versa
  const [profilesVersion, setProfilesVersion] = useState(0);
  const [dataVersion, setDataVersion] = useState(0);

  // Debounce timers — coalesce rapid per-event bumps into a single re-render
  const profilesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bumpProfilesVersion = useCallback(() => {
    if (profilesTimerRef.current) clearTimeout(profilesTimerRef.current);
    profilesTimerRef.current = setTimeout(() => setProfilesVersion((v) => v + 1), 50);
  }, []);

  const bumpDataVersion = useCallback(() => {
    if (dataTimerRef.current) clearTimeout(dataTimerRef.current);
    dataTimerRef.current = setTimeout(() => setDataVersion((v) => v + 1), 50);
  }, []);

  // Add event to runtime store (for profiles)
  const addEventToProfiles = useCallback((event: Event) => {
    nostrRuntime.addEvent(event);
    bumpProfilesVersion();
  }, [bumpProfilesVersion]);

  // Batch add events to runtime
  const addEventsToProfiles = useCallback((events: Event[]) => {
    nostrRuntime.addEvents(events);
    bumpProfilesVersion();
  }, [bumpProfilesVersion]);

  // Add event to runtime store (for reactions, comments, zaps, reposts)
  const addEventToMap = useCallback((event: Event) => {
    nostrRuntime.addEvent(event);
    bumpDataVersion();
  }, [bumpDataVersion]);

  // Batch add events to runtime
  const addEventsToMap = useCallback((events: Event[]) => {
    nostrRuntime.addEvents(events);
    bumpDataVersion();
  }, [bumpDataVersion]);

  // Query runtime for profiles
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const profiles = useMemo(() => {
    const events = nostrRuntime.query({ kinds: [0] });
    const profileMap = new Map<string, Profile>();

    for (const event of events) {
      try {
        const content = JSON.parse(event.content);
        profileMap.set(event.pubkey, { ...content, event });
      } catch (e) {
        console.error("Error parsing profile event", e);
      }
    }

    return profileMap;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profilesVersion]);

  // Query runtime for comments map (kind 1 with e tags)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const commentsMap = useMemo(() => {
    const events = nostrRuntime.query({ kinds: [1] });
    const map = new Map<string, Event[]>();

    for (const event of events) {
      const eTag = event.tags.find((tag) => tag[0] === "e");
      if (eTag) {
        const targetId = eTag[1];
        const existing = map.get(targetId) || [];
        map.set(targetId, [...existing, event]);
      }
    }

    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  // Query runtime for likes map (kind 7 with e tags)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const likesMap = useMemo(() => {
    const events = nostrRuntime.query({ kinds: [7] });
    const map = new Map<string, Event[]>();

    for (const event of events) {
      const eTag = event.tags.find((tag) => tag[0] === "e");
      if (eTag) {
        const targetId = eTag[1];
        const existing = map.get(targetId) || [];
        map.set(targetId, [...existing, event]);
      }
    }

    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  // Query runtime for zaps map (kind 9735 with e tags)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const zapsMap = useMemo(() => {
    const events = nostrRuntime.query({ kinds: [9735] });
    const map = new Map<string, Event[]>();

    for (const event of events) {
      const eTag = event.tags.find((tag) => tag[0] === "e");
      if (eTag) {
        const targetId = eTag[1];
        const existing = map.get(targetId) || [];
        map.set(targetId, [...existing, event]);
      }
    }

    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  // Query runtime for reposts map (kind 6 or 16 with e tags)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const repostsMap = useMemo(() => {
    const events = nostrRuntime.query({ kinds: [6, 16] });
    const map = new Map<string, Event[]>();

    for (const event of events) {
      const eTag = event.tags.find((tag) => tag[0] === "e");
      if (eTag) {
        const targetId = eTag[1];
        const existing = map.get(targetId) || [];
        map.set(targetId, [...existing, event]);
      }
    }

    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  // Getter methods for individual queries
  const getProfile = (pubkey: string): Profile | undefined => {
    return profiles.get(pubkey);
  };

  const getComments = (eventId: string): Event[] => {
    return commentsMap.get(eventId) || [];
  };

  const getLikes = (eventId: string): Event[] => {
    return likesMap.get(eventId) || [];
  };

  const getZaps = (eventId: string): Event[] => {
    return zapsMap.get(eventId) || [];
  };

  const getReposts = (eventId: string): Event[] => {
    return repostsMap.get(eventId) || [];
  };

  const ProfileThrottler = useRef(
    new Throttler(50, pool, addEventsToProfiles, "profiles", 500),
  );
  const CommentsThrottler = useRef(
    new Throttler(50, pool, addEventsToMap, "comments", 1000),
  );
  const LikesThrottler = useRef(
    new Throttler(50, pool, addEventsToMap, "likes", 1500),
  );
  const ZapsThrottler = useRef(
    new Throttler(50, pool, addEventsToMap, "zaps", 2000),
  );
  const RepostsThrottler = useRef(
    new Throttler(50, pool, addEventsToMap, "reposts", 2500),
  );

  const fetchUserProfileThrottled = (pubkey: string) => {
    ProfileThrottler.current.addId(pubkey);
  };

  const fetchCommentsThrottled = (pollEventId: string) => {
    CommentsThrottler.current.addId(pollEventId);
  };

  const fetchLikesThrottled = (pollEventId: string) => {
    LikesThrottler.current.addId(pollEventId);
  };

  const fetchZapsThrottled = (pollEventId: string) => {
    ZapsThrottler.current.addId(pollEventId);
  };

  const fetchRepostsThrottled = (pollEventId: string) => {
    RepostsThrottler.current.addId(pollEventId);
  };

  return (
    <AppContext.Provider
      value={{
        profiles,
        commentsMap,
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
        fetchLikesThrottled,
        fetchZapsThrottled,
        fetchRepostsThrottled,
        aiSettings,
        setAISettings,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
