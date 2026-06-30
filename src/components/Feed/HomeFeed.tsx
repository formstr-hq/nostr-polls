import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Event, Filter, verifyEvent } from "nostr-tools";
import { Box, Typography } from "@mui/material";
import { useRelays } from "../../hooks/useRelays";
import { useUserContext } from "../../hooks/useUserContext";
import { useReports } from "../../hooks/useReports";
import { useSubNav } from "../../contexts/SubNavContext";
import { safeSetItem } from "../../utils/localStorage";
import { useFeedActions } from "../../contexts/FeedActionsContext";
import { useAppContext } from "../../hooks/useAppContext";
import { dataLayer } from "@formstr/local-relay";
import UnifiedFeed from "./UnifiedFeed";
import { Notes } from "../Notes";
import PollResponseForm from "../PollResponse/PollResponseForm";
import { ArticleCard } from "../Articles/ArticleCard";
import RepostsCard from "./NotesFeed/components/RepostedNoteCard";
import { MusicCard, KIND_MUSIC } from "../Music/MusicCard";

const KIND_NOTE = 1;
const KIND_POLL = 1068;
const KIND_ARTICLE = 30023;
const KIND_REPOST = 6;
const KIND_RESPONSE = [1018, 1070];
const FEED_KINDS = [KIND_NOTE, KIND_POLL, KIND_ARTICLE, KIND_REPOST, KIND_MUSIC];

const STORAGE_KEY = "pollerama:homeSource";
// Page size for a single all-kinds query. One filter spanning every feed kind
// (rather than one query per kind) returns the genuinely most-recent events
// intermixed, so the stream stays chronological instead of clustering by kind.
const BATCH_SIZE = 30;
const FETCH_TIMEOUT_MS = 6000;

// Home intentionally has no "global" source — an unmoderated firehose is a poor
// default. The stream is scoped to people you follow, or your wider network
// (web of trust / friends of friends).
type Source = "following" | "network";

// Root notes only — drop replies (any note carrying an "e" tag) so the home
// stream stays a feed of top-level posts rather than conversation fragments.
const isRootNote = (event: Event) => !event.tags.some((t) => t[0] === "e");

// Stable identity for an event. Addressable (30000-39999) and replaceable
// (10000-19999, plus 0/3) events keep the same coordinate across edits, so the
// same article republished — or different versions returned by different relays
// — must collapse to one entry. Everything else is unique by id.
const isAddressableOrReplaceable = (kind: number) =>
  (kind >= 30000 && kind < 40000) ||
  (kind >= 10000 && kind < 20000) ||
  kind === 0 ||
  kind === 3;

const dedupeKey = (event: Event): string => {
  if (isAddressableOrReplaceable(event.kind)) {
    const d = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
    return `${event.kind}:${event.pubkey}:${d}`;
  }
  return event.id;
};

// One unified item renderer keyed off the event kind. All kinds share the same
// wrapper so notes, polls, and articles align to the same width in the feed
// (the column itself is capped/centered by FeedsLayout).
const HomeItem = React.memo(
  ({ event, userResponse }: { event: Event; userResponse?: Event }) => {
    let inner: React.ReactNode;
    if (event.kind === KIND_POLL) {
      inner = <PollResponseForm pollEvent={event} userResponse={userResponse} />;
    } else if (event.kind === KIND_ARTICLE) {
      inner = <ArticleCard event={event} />;
    } else if (event.kind === KIND_MUSIC) {
      inner = <MusicCard event={event} />;
    } else {
      inner = <Notes event={event} />;
    }
    return <Box sx={{ width: "100%", mb: "1.5rem" }}>{inner}</Box>;
  }
);

const HomeFeed: React.FC = () => {
  const { relays } = useRelays();
  const { user } = useUserContext();
  const { fetchUserProfileThrottled, profiles } = useAppContext();
  const { requestReportCheck, requestUserReportCheck } = useReports();
  const { setItems, clearItems } = useSubNav();
  const { registerRefresh } = useFeedActions();

  const [source, setSource] = useState<Source>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "network" ? "network" : "following";
  });
  const [events, setEvents] = useState<Event[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [userResponses, setUserResponses] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  const cursorRef = useRef<number | undefined>(undefined);
  const loadingRef = useRef(false);
  // Keys currently shown in the feed.
  const displayedRef = useRef<Set<string>>(new Set());
  // Newer items pulled in the background but NOT yet shown — surfaced as a
  // "+N new" action in the SpeedDial so the user merges them on demand instead
  // of the feed shifting under them. Map keeps newest per key.
  const pendingRef = useRef<Map<string, Event>>(new Map());
  // Newest created_at we know about (displayed or pending) — the cutoff for
  // polling so we only ask relays for things we haven't seen.
  const newestRef = useRef(0);

  const bumpNewest = (ts: number) => {
    if (ts > newestRef.current) newestRef.current = ts;
  };

  // Always author-scoped (no global). Returns an empty list when there's no
  // user / no follows / no network so the caller can short-circuit instead of
  // accidentally issuing an unscoped (global) query.
  const authorsForSource = useCallback((): string[] => {
    if (source === "network") return Array.from(user?.webOfTrust ?? []);
    return user?.follows ?? [];
  }, [source, user]);

  // The data layer contract has no synchronous store read (the worker owns the
  // store), so there's no instant cache-paint on (re)mount. The feed paints from
  // the live `observe` stream below, which the worker serves from cache first.
  const hydrateFromCache = useCallback((): Event[] => [], []);

  // Move buffered "new" items into the visible feed (SpeedDial "+N new" action).
  const showNewItems = useCallback(() => {
    if (pendingRef.current.size === 0) return;
    const incoming = Array.from(pendingRef.current.values());
    pendingRef.current.clear();
    setPendingCount(0);
    setEvents((prev) => {
      const map = new Map<string, Event>();
      for (const e of prev) map.set(dedupeKey(e), e);
      for (const e of incoming) {
        const k = dedupeKey(e);
        const existing = map.get(k);
        if (!existing || e.created_at > existing.created_at) map.set(k, e);
        displayedRef.current.add(k);
      }
      return Array.from(map.values()).sort((a, b) => b.created_at - a.created_at);
    });
  }, []);

  const fetchBatch = useCallback(
    (mode: "initial" | "more" | "refresh") => {
      if (loadingRef.current) return;
      if (mode === "more" && exhausted) return;
      loadingRef.current = true;

      if (mode === "initial") setLoading(true);
      else if (mode === "more") setLoadingMore(true);
      else setRefreshing(true);

      const now = Math.floor(Date.now() / 1000);
      const until = mode === "more" ? cursorRef.current ?? now : now;
      const authors = authorsForSource();

      // No people to draw from (logged out / empty follows or network) — nothing
      // to fetch. Surface the empty state rather than a spinner that never ends.
      if (authors.length === 0) {
        displayedRef.current.clear();
        pendingRef.current.clear();
        setPendingCount(0);
        setEvents([]);
        setInitialLoadDone(true);
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
        loadingRef.current = false;
        return;
      }

      // Where do freshly-arrived items go?
      //  - pagination ("more") and explicit refresh → straight into the feed.
      //  - a warm "initial" (we already have items from cache on remount) →
      //    buffer as "new" so the feed doesn't jump/skip under the user.
      //  - a cold "initial" (empty feed) → straight in, there's nothing to skip.
      const target: "display" | "pending" =
        mode === "initial" && displayedRef.current.size > 0 ? "pending" : "display";

      const displayBatch: Event[] = [];
      let oldestTs: number | undefined;
      let settled = false;

      const filters: Filter[] = [
        { kinds: FEED_KINDS, authors, limit: BATCH_SIZE, until },
      ];

      const finalize = () => {
        if (settled) return;
        settled = true;

        if (target === "pending") {
          setPendingCount(pendingRef.current.size);
        } else {
          // An empty older page means we've reached the end of the stream.
          if (mode === "more" && displayBatch.length === 0) setExhausted(true);
          if (oldestTs) cursorRef.current = oldestTs - 1;

          setEvents((prev) => {
            const map = new Map<string, Event>();
            for (const e of prev) map.set(dedupeKey(e), e);
            for (const e of displayBatch) {
              const k = dedupeKey(e);
              const existing = map.get(k);
              if (!existing || e.created_at > existing.created_at) map.set(k, e);
            }
            return Array.from(map.values()).sort((a, b) => b.created_at - a.created_at);
          });
        }

        setInitialLoadDone(true);
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
        loadingRef.current = false;
      };

      // Under the dataLayer contract the local EOSE fires before the worker's
      // upstream fetch returns, so committing on EOSE would settle this batch
      // empty. Instead we commit shortly after the event stream goes quiet, with
      // the timeout below as a hard cap.
      let quietTimer: ReturnType<typeof setTimeout> | null = null;
      const scheduleCommit = () => {
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(() => {
          finalize();
          handle.unobserve();
        }, 900);
      };

      const handle = dataLayer.observe(filters, {
        onEvent: (event: Event) => {
          if (!verifyEvent(event)) return;
          if (event.kind === KIND_NOTE && !isRootNote(event)) return;
          const key = dedupeKey(event);
          if (displayedRef.current.has(key)) return; // already on screen
          bumpNewest(event.created_at);
          if (!profiles?.get(event.pubkey)) fetchUserProfileThrottled(event.pubkey);

          if (target === "pending") {
            const existing = pendingRef.current.get(key);
            if (!existing || event.created_at > existing.created_at) {
              pendingRef.current.set(key, event);
            }
          } else {
            displayedRef.current.add(key);
            displayBatch.push(event);
            if (!oldestTs || event.created_at < oldestTs) oldestTs = event.created_at;
          }
          scheduleCommit();
        },
      });

      setTimeout(() => {
        if (quietTimer) clearTimeout(quietTimer);
        finalize();
        handle.unobserve();
      }, FETCH_TIMEOUT_MS);
    },
    [authorsForSource, exhausted, profiles, fetchUserProfileThrottled]
  );

  // Poll for items newer than anything we've seen and buffer them as "new".
  const checkForNewer = useCallback(() => {
    const authors = authorsForSource();
    if (!authors.length || !relays?.length || newestRef.current === 0) return;

    const filters: Filter[] = [
      { kinds: FEED_KINDS, authors, since: newestRef.current + 1, limit: BATCH_SIZE },
    ];

    const handle = dataLayer.observe(filters, {
      onEvent: (event: Event) => {
        if (!verifyEvent(event)) return;
        if (event.kind === KIND_NOTE && !isRootNote(event)) return;
        const key = dedupeKey(event);
        if (displayedRef.current.has(key)) return;
        bumpNewest(event.created_at);
        if (!profiles?.get(event.pubkey)) fetchUserProfileThrottled(event.pubkey);
        const existing = pendingRef.current.get(key);
        if (!existing || event.created_at > existing.created_at) {
          pendingRef.current.set(key, event);
        }
        setPendingCount(pendingRef.current.size);
      },
      // No onEose: newer items stream in via onEvent after the worker's upstream
      // fetch (local EOSE precedes it); the timeout below closes the interest.
    });

    setTimeout(() => {
      setPendingCount(pendingRef.current.size);
      handle.unobserve();
    }, FETCH_TIMEOUT_MS);
  }, [relays, authorsForSource, profiles, fetchUserProfileThrottled]);

  // Fetch the logged-in user's poll responses once so polls can pre-fill the
  // user's prior answer.
  useEffect(() => {
    if (!user) return;
    const handle = dataLayer.observe(
      [{ kinds: KIND_RESPONSE, authors: [user.pubkey], limit: 100 }],
      {
        onEvent: (event: Event) => {
          if (verifyEvent(event)) setUserResponses((prev) => [...prev, event]);
        },
      }
    );
    return () => handle.unobserve();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const latestResponses = useMemo(() => {
    const map = new Map<string, Event>();
    for (const event of userResponses) {
      const pollId = event.tags.find((t) => t[0] === "e")?.[1];
      if (!pollId) continue;
      if (!map.has(pollId) || event.created_at > map.get(pollId)!.created_at) {
        map.set(pollId, event);
      }
    }
    return map;
  }, [userResponses]);

  // Fold kind-6 reposts into the feed. Reposts of the same note collapse to one
  // entry (with all reposters), and a note that's also reposted shows once with a
  // "reposted by" header, ordered by the most recent repost. NIP-18 stringifies
  // the original event into the repost's `content`, so a repost of a note from
  // someone you don't follow still renders even though the note isn't fetched
  // directly. Non-repost events pass through unchanged, ordered by created_at.
  type FeedItem =
    | { type: "event"; event: Event; sortTime: number }
    | { type: "repost"; note: Event; reposts: Event[]; sortTime: number };

  const feedItems = useMemo<FeedItem[]>(() => {
    const reposts = events.filter((e) => e.kind === KIND_REPOST);
    const others = events.filter((e) => e.kind !== KIND_REPOST);

    // Group reposts by original note id, recovering the embedded original body.
    const groups = new Map<string, { note?: Event; reposts: Event[] }>();
    for (const r of reposts) {
      const originalId = r.tags.find((t) => t[0] === "e")?.[1];
      if (!originalId) continue;
      const g = groups.get(originalId) || { reposts: [] };
      g.reposts.push(r);
      if (!g.note && r.content) {
        try {
          const embedded = JSON.parse(r.content) as Event;
          if (embedded?.id === originalId && embedded.kind === KIND_NOTE) {
            g.note = embedded;
          }
        } catch {
          // malformed repost content — skip, may still resolve via a direct copy
        }
      }
      groups.set(originalId, g);
    }

    // A reposted note that's also directly in the feed should merge into the
    // repost item instead of appearing twice.
    const directByKey = new Map<string, Event>();
    for (const e of others) directByKey.set(dedupeKey(e), e);

    const items: FeedItem[] = [];
    const consumed = new Set<string>();

    groups.forEach((g, originalId) => {
      const note = directByKey.get(originalId) || g.note;
      if (!note) return; // can't render without the original body
      consumed.add(originalId);
      const latestRepost = Math.max(...g.reposts.map((r) => r.created_at));
      items.push({
        type: "repost",
        note,
        reposts: g.reposts,
        sortTime: Math.max(note.created_at, latestRepost),
      });
    });

    for (const e of others) {
      if (consumed.has(dedupeKey(e))) continue;
      items.push({ type: "event", event: e, sortTime: e.created_at });
    }

    return items.sort((a, b) => b.sortTime - a.sortTime);
  }, [events]);

  const refresh = useCallback(() => {
    cursorRef.current = undefined;
    setExhausted(false);
    fetchBatch("refresh");
  }, [fetchBatch]);

  // (Re)load whenever the source (Following/Network) changes — seed from the
  // cache first so the feed paints immediately instead of blanking. The initial
  // fetch then buffers anything newer as "+N new" rather than auto-merging
  // (which shifts the list and causes the user to skip posts).
  useEffect(() => {
    safeSetItem(STORAGE_KEY, source);
    cursorRef.current = undefined;
    pendingRef.current.clear();
    setPendingCount(0);

    const cached = hydrateFromCache();
    displayedRef.current = new Set(cached.map(dedupeKey));
    newestRef.current = cached[0]?.created_at ?? 0;
    setEvents(cached);
    setExhausted(false);
    setInitialLoadDone(cached.length > 0);
    fetchBatch("initial");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, relays]);

  // The user's follows / web-of-trust resolve asynchronously after login, so on
  // a cold start the initial fetch above often runs with an empty author set and
  // bails (showing the empty state). The [source, relays] effect won't re-run
  // when authors arrive, so kick a fetch on the empty→populated transition.
  // Without this the home feed stays blank until a manual reload (which works
  // only because follows is then cached synchronously). Fires once per
  // transition; loadingRef guards against double-fetching on a warm mount.
  const hasAuthors =
    source === "network"
      ? (user?.webOfTrust?.size ?? 0) > 0
      : (user?.follows?.length ?? 0) > 0;
  const prevHadAuthorsRef = useRef(false);
  useEffect(() => {
    const had = prevHadAuthorsRef.current;
    prevHadAuthorsRef.current = hasAuthors;
    if (!had && hasAuthors) fetchBatch("initial");
  }, [hasAuthors, fetchBatch]);

  // Poll for newer items every 60s once we have a baseline; they buffer into
  // the "+N new" prompt.
  useEffect(() => {
    if (!initialLoadDone) return;
    const interval = setInterval(checkForNewer, 60_000);
    return () => clearInterval(interval);
  }, [initialLoadDone, checkForNewer]);

  // Sub-nav (Global / Following) + register refresh with the SpeedDial.
  useEffect(() => {
    setItems([
      {
        key: "following",
        label: "Following",
        active: source === "following",
        disabled: !user || !user.follows?.length,
        onClick: () => setSource("following"),
      },
      {
        key: "network",
        label: "Network",
        active: source === "network",
        disabled: !user || !user.webOfTrust?.size,
        onClick: () => setSource("network"),
      },
    ]);
    return () => clearItems();
  }, [source, user, setItems, clearItems]);

  useEffect(() => {
    registerRefresh(refresh);
  }, [registerRefresh, refresh]);

  // Report checks for the visible batch. For reposts we check the original note
  // (and its author), not the repost wrapper, so moderation applies to the body
  // actually shown.
  useEffect(() => {
    if (feedItems.length > 0) {
      const ids = feedItems.map((i) => (i.type === "repost" ? i.note.id : i.event.id));
      const pubkeys = feedItems.map((i) =>
        i.type === "repost" ? i.note.pubkey : i.event.pubkey
      );
      requestReportCheck(ids);
      requestUserReportCheck(pubkeys);
    }
  }, [feedItems, requestReportCheck, requestUserReportCheck]);

  const handleEndReached = useCallback(() => {
    if (!loadingRef.current && initialLoadDone && !exhausted) fetchBatch("more");
  }, [initialLoadDone, exhausted, fetchBatch]);

  return (
    <UnifiedFeed
      data={feedItems}
      loading={loading && feedItems.length === 0}
      loadingMore={loadingMore}
      refreshing={refreshing}
      onEndReached={handleEndReached}
      onRefresh={refresh}
      onRefreshNewer={checkForNewer}
      newItemCount={pendingCount}
      onShowNewItems={showNewItems}
      newItemLabel="posts"
      computeItemKey={(_, item) =>
        item.type === "repost" ? `repost:${item.note.id}` : dedupeKey(item.event)
      }
      emptyState={
        initialLoadDone && feedItems.length === 0 ? (
          <Box display="flex" justifyContent="center" px={3} py={8}>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              {!user
                ? "Log in and follow people to build your home feed."
                : source === "network"
                ? "Nothing yet from your network."
                : "Nothing yet from people you follow."}
            </Typography>
          </Box>
        ) : undefined
      }
      itemContent={(_, item) =>
        item.type === "repost" ? (
          <RepostsCard note={item.note} reposts={item.reposts} />
        ) : (
          <HomeItem
            event={item.event}
            userResponse={latestResponses.get(item.event.id)}
          />
        )
      }
    />
  );
};

export default HomeFeed;
