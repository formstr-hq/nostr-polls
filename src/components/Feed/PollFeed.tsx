import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Event, Filter } from "nostr-tools";
import { verifyEvent } from "nostr-tools";
import { useUserContext } from "../../hooks/useUserContext";
import { useReports } from "../../hooks/useReports";
import { Box } from "@mui/material";
import FeedError from "./FeedError";
import { dataLayer } from "@formstr/local-relay";
import UnifiedFeed from "./UnifiedFeed";
import PollResponseForm from "../PollResponse/PollResponseForm";
import RepeatIcon from "@mui/icons-material/Repeat";
import OverlappingAvatars from "../Common/OverlappingAvatars";
import { useSubNav } from "../../contexts/SubNavContext";
import { useFeedActions } from "../../contexts/FeedActionsContext";
import { safeSetItem } from "../../utils/localStorage";
import { useRelayRefresh } from "../../dataLayer/hooks";
import { isRelayHydrated } from "../../dataLayer/relayRefresh";

// Minimal closer shape the feed tracks. The worker owns relays/chunking, so the
// app only needs to be able to drop its interest.
type FeedSub = { unsubscribe: () => void };

const KIND_POLL = 1068;
const KIND_RESPONSE = [1018, 1070];
const KIND_REPOST = 16;
const FETCH_TIMEOUT_MS = 8000;

// Stable empty array — avoids creating a new reference on every render for
// polls that have no reposts, which would defeat React.memo on PollFeedItem.
const EMPTY_REPOSTS: Event[] = [];

// ---------------------------------------------------------------------------
// PollFeedItem
//
// Defined OUTSIDE PollFeed so its reference is stable across renders.
// Renders PollResponseForm directly — no internal useState/useEffect — so
// Virtuoso always sees a single, synchronous render per item.  The old Feed
// wrapper used useEffect+setState (a two-render cycle) which caused item
// heights to differ between the first and second render, corrupting Virtuoso's
// top-spacer calculation and making items at the top "disappear" after
// scrolling down and back up.
// ---------------------------------------------------------------------------
interface PollFeedItemProps {
  event: Event;
  reposts: Event[];
  userResponse: Event | undefined;
}

const PollFeedItem = React.memo(
  ({ event, reposts, userResponse }: PollFeedItemProps) => {
    // Dedupe by reposter so each person counts once.
    const repostedBy = Array.from(new Set(reposts.map((r) => r.pubkey)));
    return (
      <Box sx={{ my: "20px", mx: { xs: 0, sm: "auto" }, width: "100%", maxWidth: { xs: "100%", sm: "600px" } }}>
        {repostedBy.length > 0 && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              mb: 0.75,
              ml: "10px",
              color: "primary.main",
            }}
          >
            <RepeatIcon fontSize="small" />
            <OverlappingAvatars ids={repostedBy} />
          </Box>
        )}
        <PollResponseForm pollEvent={event} userResponse={userResponse} />
      </Box>
    );
  }
);

// Note: relay selection + chunking are handled automatically by the worker.

export const PollFeed = () => {
  const [pollEvents, setPollEvents] = useState<Event[]>([]);
  const [repostEvents, setRepostEvents] = useState<Event[]>([]);
  const [userResponses, setUserResponses] = useState<Event[]>([]);
  const [eventSource, setEventSource] = useState<"global" | "following" | "webOfTrust">(() => {
    const saved = localStorage.getItem("pollerama:pollSource");
    return (saved === "following" || saved === "webOfTrust") ? saved : "global";
  });
  const [feedSubscription, setFeedSubscription] = useState<
    FeedSub | undefined
  >();
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingPollEvents, setPendingPollEvents] = useState<Event[]>([]);
  // Ref so handleIncomingEvent can read the current value without a stale closure
  const loadingInitialRef = useRef(true);
  const relayRefresh = useRelayRefresh();

  const { user } = useUserContext();
  const { requestReportCheck, requestUserReportCheck } = useReports();
  const { setItems, clearItems } = useSubNav();
  const { registerRefresh } = useFeedActions();

  useEffect(() => {
    safeSetItem("pollerama:pollSource", eventSource);
    setItems([
      {
        key: "global",
        label: "Global",
        active: eventSource === "global",
        onClick: () => setEventSource("global"),
      },
      {
        key: "following",
        label: "Following",
        active: eventSource === "following",
        onClick: () => setEventSource("following"),
        disabled: !user || !user.follows?.length,
      },
      {
        key: "webOfTrust",
        label: "Web of Trust",
        active: eventSource === "webOfTrust",
        onClick: () => setEventSource("webOfTrust"),
        disabled: !user || !user.webOfTrust || !user.webOfTrust.size,
      },
    ]);
    return () => clearItems();
  }, [eventSource, user, setItems, clearItems]);

  const mergeEvents = (existing: Event[], incoming: Event[]): Event[] => {
    const map = new Map(existing.map((e) => [e.id, e]));
    for (const e of incoming) {
      map.set(e.id, e); // Overwrite duplicates
    }
    return Array.from(map.values()).sort((a, b) => b.created_at - a.created_at);
  };

  // Keep the ref in sync so handleIncomingEvent always sees the live value
  useEffect(() => {
    loadingInitialRef.current = loadingInitial;
  }, [loadingInitial]);

  const handleIncomingEvent = useCallback((event: Event) => {
    if (!verifyEvent(event)) return;
    if (event.kind === KIND_REPOST) {
      // Reposts affect sort order of existing items — add immediately
      setRepostEvents((prev) => mergeEvents(prev, [event]));
    } else if (loadingInitialRef.current) {
      // Initial load — add directly so the feed populates
      setPollEvents((prev) => mergeEvents(prev, [event]));
    } else {
      // After initial load — buffer so the user can choose when to show them
      setPendingPollEvents((prev) => mergeEvents(prev, [event]));
    }
  }, []);

  const showNewPolls = useCallback(() => {
    setPollEvents((prev) => mergeEvents(prev, pendingPollEvents));
    setPendingPollEvents([]);
  }, [pendingPollEvents]);

  // Helper to declare interest in poll events. The worker owns relay selection
  // and chunking; the app just supplies filters and an EOSE callback.
  const subscribeWithAuthors = useCallback(
    (filters: Filter[], onAllChunksComplete?: () => void): FeedSub => {
      const handle = dataLayer.observe(filters, {
        onEvent: handleIncomingEvent,
        onEose: () => {
          onAllChunksComplete?.();
        },
      });
      return { unsubscribe: () => handle.unobserve() };
    },
    [handleIncomingEvent]
  );

  const loadMore = () => {
    if (loadingMore || !pollEvents.length) return;
    setLoadingMore(true);

    const oldest = Math.min(...pollEvents.map((e) => e.created_at));
    const filterPoll: Filter = {
      kinds: [KIND_POLL],
      until: oldest,
      limit: 20,
    };
    const filterResposts: Filter = {
      kinds: [KIND_REPOST],
      until: oldest,
      "#k": ["1068"],
    };

    if (eventSource === "following" && user?.follows?.length) {
      filterPoll.authors = user.follows;
      filterResposts.authors = user.follows;
    }
    if (
      eventSource === "webOfTrust" &&
      user?.webOfTrust &&
      user.webOfTrust.size
    ) {
      const authors = Array.from(user.webOfTrust);
      filterPoll.authors = authors;
      filterResposts.authors = authors;
    }

    const closer = subscribeWithAuthors([filterPoll, filterResposts], () => {
      setLoadingMore(false);
    });
    setFeedSubscription(closer);
  };

  const fetchInitialPolls = useCallback((fresh?: boolean) => {
    const filterPolls: Filter = {
      kinds: [KIND_POLL],
      limit: 40,
    };
    const filterResposts: Filter = {
      kinds: [KIND_REPOST],
      "#k": ["1068"],
    };

    if (eventSource === "following" && user?.follows?.length) {
      filterPolls.authors = user.follows;
      filterResposts.authors = user.follows;
    }
    if (
      eventSource === "webOfTrust" &&
      user?.webOfTrust &&
      user.webOfTrust.size
    ) {
      const authors = Array.from(user.webOfTrust);
      filterPolls.authors = authors;
      filterResposts.authors = authors;
    }

    let eoseFired = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const onComplete = (failed = false) => {
      if (eoseFired) return;
      // A pre-hydration EOSE means the store was still loading, not actually
      // empty — wait for the hydration-triggered re-run (relayRefresh dep
      // below) instead of flashing an empty/failed state. The hard timeout
      // above still fires `failed` regardless, so this can't hang forever.
      if (!failed && !isRelayHydrated()) return;
      eoseFired = true;
      clearTimeout(timeoutId);
      if (failed) {
        setLoadFailed(true);
        setLoadingInitial(false);
        setRefreshing(false);
        loadingInitialRef.current = false;
      } else if (fresh) {
        setRefreshing(false);
        loadingInitialRef.current = false;
      } else {
        setLoadingInitial(false);
      }
    };

    const closer = subscribeWithAuthors([filterPolls, filterResposts], () => onComplete());

    timeoutId = setTimeout(() => {
      closer.unsubscribe();
      onComplete(true);
    }, FETCH_TIMEOUT_MS);

    return closer;
  }, [eventSource, user, subscribeWithAuthors]);

  const refreshFeed = useCallback(() => {
    if (feedSubscription) feedSubscription.unsubscribe();
    // Don't clear existing events — keep showing old data while refreshing.
    // New events will merge in as they arrive from the network.
    setLoadFailed(false);
    setPendingPollEvents([]);
    setRefreshing(true);
    // Temporarily treat incoming events as direct (not pending) during refresh
    loadingInitialRef.current = true;
    const closer = fetchInitialPolls(true);
    setFeedSubscription(closer);
  }, [feedSubscription, fetchInitialPolls]);

  useEffect(() => {
    registerRefresh(refreshFeed);
  }, [registerRefresh, refreshFeed]);

  const pollForNewPolls = () => {
    const since = pollEvents[0]?.created_at || Math.floor(Date.now() / 1000);
    const filterPolls: Filter = {
      kinds: [KIND_POLL],
      since: since + 1,
    };
    const filterResposts: Filter = {
      kinds: [KIND_REPOST],
      since: since + 1,
      "#k": ["1068"],
    };

    if (eventSource === "following" && user?.follows?.length) {
      filterPolls.authors = user.follows;
      filterResposts.authors = user.follows;
    }
    if (
      eventSource === "webOfTrust" &&
      user?.webOfTrust &&
      user.webOfTrust.size
    ) {
      const authors = Array.from(user.webOfTrust);
      filterPolls.authors = authors;
      filterResposts.authors = authors;
    }

    return subscribeWithAuthors([filterPolls, filterResposts]);
  };

  const fetchUserResponses = () => {
    if (!user) return;

    const filter: Filter[] = [
      {
        kinds: KIND_RESPONSE,
        authors: [user.pubkey],
        limit: 40,
      },
    ];

    const handle = dataLayer.observe(filter, {
      onEvent: (event: Event) => {
        if (verifyEvent(event)) {
          setUserResponses((prev) => [...prev, event]);
        }
      },
    });

    return { unsubscribe: () => handle.unobserve() };
  };

  const getLatestResponsesByPoll = (events: Event[]) => {
    const map = new Map<string, Event>();
    for (const event of events) {
      const pollId = event.tags.find((t) => t[0] === "e")?.[1];
      if (!pollId) continue;
      if (!map.has(pollId) || event.created_at > map.get(pollId)!.created_at) {
        map.set(pollId, event);
      }
    }
    return map;
  };

  const latestResponses = useMemo(
    () => getLatestResponsesByPoll(userResponses),
    [userResponses]
  );

  const repostsByPollId = useMemo(() => {
    const map = new Map<string, Event[]>();
    repostEvents.forEach((repost) => {
      let originalId = repost.tags.find((t) => t[0] === "q")?.[1];
      if (!originalId) originalId = repost.tags.find((t) => t[0] === "e")?.[1];
      if (!originalId) return;
      const arr = map.get(originalId) || [];
      arr.push(repost);
      map.set(originalId, arr);
    });
    return map;
  }, [repostEvents]);

  // Sort by creation time only — repost activity intentionally excluded from sort key.
  // Sorting by repost time caused `combinedEvents` to re-sort on every incoming repost,
  // which moved items between indices mid-scroll and corrupted Virtuoso's top spacer,
  // making the newest items unreachable after scrolling down and back up.
  const combinedEvents = useMemo(() => {
    return [...pollEvents].sort((a, b) => b.created_at - a.created_at);
  }, [pollEvents]);

  // Request WoT report check for all visible polls and their authors
  useEffect(() => {
    if (combinedEvents.length > 0) {
      requestReportCheck(combinedEvents.map((e) => e.id));
      requestUserReportCheck(combinedEvents.map((e) => e.pubkey));
    }
  }, [combinedEvents, requestReportCheck, requestUserReportCheck]);

  useEffect(() => {
    if (feedSubscription) feedSubscription.unsubscribe();
    setPollEvents([]);
    setRepostEvents([]);
    setPendingPollEvents([]);
    setLoadingInitial(true);
    const closer = fetchInitialPolls();
    setFeedSubscription(closer);
    return () => closer?.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventSource, relayRefresh]);

  useEffect(() => {
    let closer: FeedSub | undefined;
    if (user && userResponses.length === 0) {
      closer = fetchUserResponses();
    }
    return () => closer?.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    const pollHandle = { current: null as ReturnType<typeof subscribeWithAuthors> | null };
    const interval = setInterval(() => {
      // Close the previous polling subscription before opening a new one
      pollHandle.current?.unsubscribe();
      pollHandle.current = pollForNewPolls();
    }, 60_000);
    return () => {
      clearInterval(interval);
      pollHandle.current?.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollEvents, repostEvents, eventSource]);

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <UnifiedFeed
          data={combinedEvents}
          loading={loadingInitial && !loadFailed}
          loadingMore={loadingMore}
          refreshing={refreshing}
          onEndReached={loadMore}
          onRefresh={refreshFeed}
          computeItemKey={(_, event) => event.id}
          newItemCount={pendingPollEvents.length}
          onShowNewItems={showNewPolls}
          newItemLabel="polls"
          emptyState={
            (loadFailed || (!loadingInitial && combinedEvents.length === 0))
              ? <FeedError message="Couldn't load polls" onRetry={refreshFeed} />
              : undefined
          }
          itemContent={(_, event) => (
            <PollFeedItem
              event={event}
              reposts={repostsByPollId.get(event.id) ?? EMPTY_REPOSTS}
              userResponse={latestResponses.get(event.id)}
            />
          )}
        />
      </Box>
    </Box>
  );
};
