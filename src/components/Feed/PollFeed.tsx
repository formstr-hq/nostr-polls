import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Event, Filter } from "nostr-tools";
import { verifyEvent } from "nostr-tools";
import { useUserContext } from "../../hooks/useUserContext";
import { useRelays } from "../../hooks/useRelays";
import {
  Select,
  MenuItem,
  Box,
  Typography,
} from "@mui/material";
import { styled } from "@mui/system";
import { nostrRuntime } from "../../singletons";
import { SubscriptionHandle } from "../../nostrRuntime/types";
import UnifiedFeed from "./UnifiedFeed";
import PollResponseForm from "../PollResponse/PollResponseForm";
import ReplayIcon from "@mui/icons-material/Replay";
import OverlappingAvatars from "../Common/OverlappingAvatars";

const KIND_POLL = 1068;
const KIND_RESPONSE = [1018, 1070];
const KIND_REPOST = 16;

// Stable empty array — avoids creating a new reference on every render for
// polls that have no reposts, which would defeat React.memo on PollFeedItem.
const EMPTY_REPOSTS: Event[] = [];

const StyledSelect = styled(Select)`
  &::before,
  &::after {
    border-bottom: none !important;
  }
`;

const CenteredBox = styled(Box)`
  display: flex;
  justify-content: center;
`;

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
    const repostedBy = reposts.map((r) => r.pubkey);
    return (
      <Box sx={{ margin: "20px auto", width: "100%", maxWidth: "600px" }}>
        {repostedBy.length > 0 && (
          <Box
            sx={{
              fontSize: "0.75rem",
              color: "#4caf50",
              ml: "10px",
              mr: "10px",
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
            }}
          >
            <ReplayIcon />
            <Typography sx={{ mr: 1 }}>Reposted by</Typography>
            <OverlappingAvatars ids={repostedBy} />
          </Box>
        )}
        <PollResponseForm pollEvent={event} userResponse={userResponse} />
      </Box>
    );
  }
);

// Note: Chunking is now handled automatically by nostrRuntime

export const PollFeed = () => {
  const [pollEvents, setPollEvents] = useState<Event[]>([]);
  const [repostEvents, setRepostEvents] = useState<Event[]>([]);
  const [userResponses, setUserResponses] = useState<Event[]>([]);
  const [eventSource, setEventSource] = useState<
    "global" | "following" | "webOfTrust"
  >("global");
  const [feedSubscription, setFeedSubscription] = useState<
    SubscriptionHandle | undefined
  >();
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [pendingPollEvents, setPendingPollEvents] = useState<Event[]>([]);
  // Ref so handleIncomingEvent can read the current value without a stale closure
  const loadingInitialRef = useRef(true);

  const { user } = useUserContext();
  const { relays } = useRelays();

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

  // Helper to subscribe - runtime handles chunking automatically for large author lists
  const subscribeWithAuthors = useCallback(
    (filters: Filter[], onAllChunksComplete?: () => void) => {
      const handle = nostrRuntime.subscribe(relays, filters, {
        onEvent: handleIncomingEvent,
        onEose: () => {
          onAllChunksComplete?.();
        },
      });

      // Return a wrapper that matches the old API
      return {
        ...handle,
        close: () => handle.unsubscribe(),
      };
    },
    [relays, handleIncomingEvent]
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

  const fetchInitialPolls = () => {
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

    const closer = subscribeWithAuthors([filterPolls, filterResposts], () => {
      setLoadingInitial(false);
    });

    return closer;
  };

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

    const handle = nostrRuntime.subscribe(relays, filter, {
      onEvent: (event: Event) => {
        if (verifyEvent(event)) {
          setUserResponses((prev) => [...prev, event]);
        }
      },
    });

    return {
      ...handle,
      close: () => handle.unsubscribe(),
    };
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
  }, [eventSource]);

  useEffect(() => {
    let closer: SubscriptionHandle | undefined;
    if (user && userResponses.length === 0) {
      closer = fetchUserResponses();
    }
    return () => closer?.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    const interval = setInterval(() => {
      pollForNewPolls();
    }, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollEvents, repostEvents, relays, eventSource]);

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <CenteredBox>
        <StyledSelect
          variant="standard"
          onChange={(e) =>
            setEventSource(
              e.target.value as "global" | "following" | "webOfTrust"
            )
          }
          value={eventSource}
        >
          <MenuItem value="global">global polls</MenuItem>
          <MenuItem
            value="following"
            disabled={!user || !user.follows?.length}
          >
            polls from people you follow
          </MenuItem>
          <MenuItem
            value="webOfTrust"
            disabled={!user || !user.webOfTrust || !user.webOfTrust.size}
          >
            polls from your web of trust
          </MenuItem>
        </StyledSelect>
      </CenteredBox>

      <Box sx={{ flex: 1, minHeight: 0 }}>
        <UnifiedFeed
          data={combinedEvents}
          loading={loadingInitial}
          loadingMore={loadingMore}
          onEndReached={loadMore}
          computeItemKey={(_, event) => event.id}
          newItemCount={pendingPollEvents.length}
          onShowNewItems={showNewPolls}
          newItemLabel="polls"
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
