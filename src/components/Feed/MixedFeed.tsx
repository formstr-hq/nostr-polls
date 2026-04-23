import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box } from "@mui/material";
import { Event, Filter, verifyEvent } from "nostr-tools";
import { useUserContext } from "../../hooks/useUserContext";
import { useRelays } from "../../hooks/useRelays";
import { useSubNav } from "../../contexts/SubNavContext";
import { useFeedActions } from "../../contexts/FeedActionsContext";
import { useReports } from "../../hooks/useReports";
import { nostrRuntime } from "../../singletons";
import { SubscriptionHandle } from "../../nostrRuntime/types";
import { getRelaysForAuthors, prefetchOutboxRelays } from "../../nostr/OutboxService";
import UnifiedFeed from "./UnifiedFeed";
import PollResponseForm from "../PollResponse/PollResponseForm";
import { Notes } from "../Notes";

const KIND_NOTE = 1;
const KIND_POLL = 1068;
const MIXED_SOURCE_KEY = "pollerama:mixedSource";
const INITIAL_BATCH_SIZE = 40;
const PAGE_BATCH_SIZE = 20;

type MixedSource = "global" | "following" | "webOfTrust";

const isRootNote = (event: Event) => !event.tags.some((t) => t[0] === "e");

const isDisplayable = (event: Event) =>
  event.kind === KIND_POLL || (event.kind === KIND_NOTE && isRootNote(event));

const mergeEvents = (existing: Event[], incoming: Event[]): Event[] => {
  const map = new Map(existing.map((event) => [event.id, event]));
  for (const event of incoming) {
    map.set(event.id, event);
  }
  return Array.from(map.values()).sort((a, b) => b.created_at - a.created_at);
};

const MixedFeedItem = React.memo(({ event }: { event: Event }) => {
  if (event.kind === KIND_POLL) {
    return (
      <Box sx={{ my: "20px", mx: { xs: 0, sm: "auto" }, width: "100%", maxWidth: { xs: "100%", sm: "600px" } }}>
        <PollResponseForm pollEvent={event} />
      </Box>
    );
  }

  return <Notes event={event} />;
});

const MixedFeed: React.FC = () => {
  const [events, setEvents] = useState<Event[]>([]);
  const [pendingEvents, setPendingEvents] = useState<Event[]>([]);
  const [eventSource, setEventSource] = useState<MixedSource>(() => {
    const saved = localStorage.getItem(MIXED_SOURCE_KEY);
    return saved === "following" || saved === "webOfTrust" ? saved : "global";
  });
  const [feedSubscription, setFeedSubscription] = useState<SubscriptionHandle | undefined>();
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const loadingInitialRef = useRef(true);
  const oldestNoteTimestampRef = useRef<number | null>(null);
  const oldestPollTimestampRef = useRef<number | null>(null);

  const { user } = useUserContext();
  const { relays } = useRelays();
  const { setItems, clearItems } = useSubNav();
  const { registerRefresh } = useFeedActions();
  const { requestReportCheck, requestUserReportCheck } = useReports();

  useEffect(() => {
    loadingInitialRef.current = loadingInitial;
  }, [loadingInitial]);

  useEffect(() => {
    localStorage.setItem(MIXED_SOURCE_KEY, eventSource);
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

  const getSourceFilters = useCallback(
    (filters: Filter[]) => {
      const nextFilters: Filter[] = filters.map((filter) => ({ ...filter }));
      let relayOverride: string[] | undefined;

      if (eventSource === "following" && user?.follows?.length) {
        const authors = user.follows;
        nextFilters.forEach((filter) => {
          filter.authors = authors;
        });
        prefetchOutboxRelays(authors);
        relayOverride = getRelaysForAuthors(relays, authors);
      }

      if (eventSource === "webOfTrust" && user?.webOfTrust?.size) {
        const authors = Array.from(user.webOfTrust);
        nextFilters.forEach((filter) => {
          filter.authors = authors;
        });
        prefetchOutboxRelays(authors);
        relayOverride = getRelaysForAuthors(relays, authors);
      }

      return { filters: nextFilters, relayOverride };
    },
    [eventSource, user, relays]
  );

  const handleIncomingEvent = useCallback((event: Event) => {
    if (!verifyEvent(event) || !isDisplayable(event)) return;
    if (loadingInitialRef.current) {
      setEvents((prev) => mergeEvents(prev, [event]));
      return;
    }
    setPendingEvents((prev) => mergeEvents(prev, [event]));
  }, []);

  const subscribe = useCallback(
    (
      filters: Filter[],
      options?: {
        onEose?: () => void;
        fresh?: boolean;
      }
    ) => {
      const { filters: sourceFilters, relayOverride } = getSourceFilters(filters);
      return nostrRuntime.subscribe(relayOverride ?? relays, sourceFilters, {
        onEvent: handleIncomingEvent,
        onEose: options?.onEose,
        fresh: options?.fresh,
      });
    },
    [getSourceFilters, relays, handleIncomingEvent]
  );

  const buildFilters = useCallback(
    (kind: "initial" | "older" | "newer") => {
      const now = Math.floor(Date.now() / 1000);
      const noteFilter: Filter = {
        kinds: [KIND_NOTE],
        limit: kind === "initial" ? INITIAL_BATCH_SIZE : PAGE_BATCH_SIZE,
      };
      const pollFilter: Filter = {
        kinds: [KIND_POLL],
        limit: kind === "initial" ? INITIAL_BATCH_SIZE : PAGE_BATCH_SIZE,
      };

      if (kind === "initial") {
        noteFilter.since = now - 86400;
        pollFilter.since = now - 86400;
      } else if (kind === "older") {
        if (oldestNoteTimestampRef.current != null) {
          noteFilter.until = oldestNoteTimestampRef.current;
        }
        if (oldestPollTimestampRef.current != null) {
          pollFilter.until = oldestPollTimestampRef.current;
        }
      } else {
        const newestNote = events
          .filter((event) => event.kind === KIND_NOTE)
          .reduce<number | null>((latest, event) => {
            return latest == null || event.created_at > latest ? event.created_at : latest;
          }, null);
        const newestPoll = events
          .filter((event) => event.kind === KIND_POLL)
          .reduce<number | null>((latest, event) => {
            return latest == null || event.created_at > latest ? event.created_at : latest;
          }, null);

        if (newestNote != null) {
          noteFilter.since = newestNote + 1;
        }
        if (newestPoll != null) {
          pollFilter.since = newestPoll + 1;
        }
      }

      return [noteFilter, pollFilter];
    },
    [events]
  );

  const fetchInitial = useCallback(
    (fresh?: boolean) => {
      const handle = subscribe(buildFilters("initial"), {
        fresh,
        onEose: () => {
          if (fresh) {
            setRefreshing(false);
            loadingInitialRef.current = false;
          } else {
            setLoadingInitial(false);
          }
        },
      });
      return handle;
    },
    [subscribe, buildFilters]
  );

  const refreshFeed = useCallback(() => {
    feedSubscription?.unsubscribe();
    setPendingEvents([]);
    setRefreshing(true);
    loadingInitialRef.current = true;
    const handle = fetchInitial(true);
    setFeedSubscription(handle);
  }, [feedSubscription, fetchInitial]);

  const loadMore = useCallback(() => {
    if (loadingMore || events.length === 0) return;
    setLoadingMore(true);
    const handle = subscribe(buildFilters("older"), {
      onEose: () => setLoadingMore(false),
    });
    setFeedSubscription(handle);
  }, [events.length, loadingMore, subscribe, buildFilters]);

  const showNewEvents = useCallback(() => {
    setEvents((prev) => mergeEvents(prev, pendingEvents));
    setPendingEvents([]);
  }, [pendingEvents]);

  useEffect(() => {
    registerRefresh(refreshFeed);
  }, [registerRefresh, refreshFeed]);

  useEffect(() => {
    feedSubscription?.unsubscribe();
    setEvents([]);
    setPendingEvents([]);
    setLoadingInitial(true);
    oldestNoteTimestampRef.current = null;
    oldestPollTimestampRef.current = null;
    const handle = fetchInitial();
    setFeedSubscription(handle);

    return () => handle.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventSource]);

  const pollForNew = useCallback(() => {
    return subscribe(buildFilters("newer"));
  }, [subscribe, buildFilters]);

  useEffect(() => {
    const handleRef = { current: null as SubscriptionHandle | null };
    const interval = setInterval(() => {
      handleRef.current?.unsubscribe();
      handleRef.current = pollForNew();
    }, 60_000);

    return () => {
      clearInterval(interval);
      handleRef.current?.unsubscribe();
    };
  }, [pollForNew]);

  const visibleEvents = useMemo(() => events, [events]);

  useEffect(() => {
    if (events.length === 0) {
      oldestNoteTimestampRef.current = null;
      oldestPollTimestampRef.current = null;
      return;
    }

    const oldestNote = events
      .filter((event) => event.kind === KIND_NOTE)
      .reduce<number | null>((oldest, event) => {
        return oldest == null || event.created_at < oldest ? event.created_at : oldest;
      }, null);
    const oldestPoll = events
      .filter((event) => event.kind === KIND_POLL)
      .reduce<number | null>((oldest, event) => {
        return oldest == null || event.created_at < oldest ? event.created_at : oldest;
      }, null);

    oldestNoteTimestampRef.current = oldestNote;
    oldestPollTimestampRef.current = oldestPoll;
  }, [events]);

  useEffect(() => {
    if (visibleEvents.length === 0) return;
    requestReportCheck(visibleEvents.map((event) => event.id));
    requestUserReportCheck(visibleEvents.map((event) => event.pubkey));
  }, [visibleEvents, requestReportCheck, requestUserReportCheck]);

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <UnifiedFeed
          data={visibleEvents}
          loading={loadingInitial}
          loadingMore={loadingMore}
          refreshing={refreshing}
          onEndReached={loadMore}
          onRefresh={refreshFeed}
          newItemCount={pendingEvents.length}
          onShowNewItems={showNewEvents}
          newItemLabel="posts"
          computeItemKey={(_, event) => event.id}
          itemContent={(_, event) => <MixedFeedItem event={event} />}
        />
      </Box>
    </Box>
  );
};

export default MixedFeed;
