import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Event, Filter } from "nostr-tools";
import { Box, Button, Typography } from "@mui/material";
import { dataLayer } from "@formstr/local-relay";
import { useRelayRefresh } from "../../dataLayer/hooks";
import { useUserContext } from "../../hooks/useUserContext";
import { useAppContext } from "../../hooks/useAppContext";
import { useListContext } from "../../hooks/useListContext";
import { Notes } from "../Notes";
import PollResponseForm from "../PollResponse/PollResponseForm";
import { ArticleCard } from "../Articles/ArticleCard";
import { MusicCard, KIND_MUSIC } from "../Music/MusicCard";
import { FollowPackCard } from "../FollowPacks/FollowPackCard";
import UnifiedFeed from "./UnifiedFeed";

// One bookmarkable item: either a pack (from the private 39089 refs) or an
// event resolved from a public NIP-53-style ref.
type BookmarkItem =
  | { type: "pack"; event: Event }
  | { type: "resolved"; ref: string; event: Event }
  | { type: "missing"; ref: string };

const KIND_NOTE = 1;
const KIND_POLL = 1068;
const KIND_ARTICLE = 30023;
const KIND_PACK = 39089;

const RESOLVE_TIMEOUT_MS = 5000;

// Refs are produced by `eventRefOf` in lists-context: a 64-hex third segment
// is an id reference, anything else is an addressable d-reference.
const HEX_ID = /^[0-9a-f]{64}$/i;

const refParts = (ref: string) => {
  const [kind, pubkey, third] = ref.split(":");
  return { kind, pubkey, third };
};

const matchRef = (ref: string, event: Event): boolean => {
  const { kind, pubkey, third } = refParts(ref);
  if (!kind || !pubkey || !third) return false;
  return HEX_ID.test(third)
    ? event.id === third
    : event.kind === Number(kind) &&
      event.pubkey === pubkey &&
      event.tags.some((t) => t[0] === "d" && t[1] === third);
};

const filtersForRefs = (refs: string[]): Filter[] => {
  const ids: string[] = [];
  const dQueries: Filter[] = [];
  for (const ref of refs) {
    const { kind, pubkey, third } = refParts(ref);
    if (!kind || !pubkey || !third) continue;
    if (HEX_ID.test(third)) ids.push(third);
    else dQueries.push({ kinds: [Number(kind)], authors: [pubkey], "#d": [third], limit: 1 });
  }
  if (ids.length) dQueries.push({ ids, limit: ids.length });
  return dQueries;
};

const createdAtOf = (item: BookmarkItem) =>
  item.type === "missing" ? 0 : item.event.created_at;

const BookmarksItem = React.memo(({ item }: { item: BookmarkItem }) => {
  let inner: React.ReactNode;
  if (item.type === "pack") {
    inner = <FollowPackCard event={item.event} />;
  } else if (item.type === "missing") {
    const { kind, pubkey } = refParts(item.ref);
    inner = (
      <Box sx={{ p: 2, rounded: 2, border: 1, borderColor: "divider" }}>
        <Typography variant="body2" color="text.secondary">
          Bookmark for kind {kind} by {pubkey} is no longer resolvable.
        </Typography>
      </Box>
    );
  } else {
    const { event } = item;
    if (event.kind === KIND_POLL) inner = <PollResponseForm pollEvent={event} />;
    else if (event.kind === KIND_ARTICLE) inner = <ArticleCard event={event} />;
    else if (event.kind === KIND_MUSIC) inner = <MusicCard event={event} />;
    else inner = <Notes event={event} />;
  }
  return <Box sx={{ width: "100%" }}>{inner}</Box>;
});

const BookmarksFeed: React.FC = () => {
  const { user, requestLogin } = useUserContext();
  const { fetchUserProfileThrottled, profiles } = useAppContext();
  const { bookmarkedEventRefs, bookmarkedPackKeys, lists } = useListContext();
  const relayRefresh = useRelayRefresh();

  const [items, setItems] = useState<BookmarkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const resolvingRef = useRef(false);

  // Bookmarked packs come straight from context (already hydrated).
  const bookmarkedPacks = useMemo(
    () =>
      Array.from(lists?.entries() ?? [])
        .filter(([key, e]) => e.kind === KIND_PACK && bookmarkedPackKeys.has(key))
        .map(([, e]) => e as Event),
    [lists, bookmarkedPackKeys]
  );

  const refList = useMemo(() => Array.from(bookmarkedEventRefs), [bookmarkedEventRefs]);

  const resolve = useCallback(() => {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    setLoading(true);

    const itemsFromPacks: BookmarkItem[] = bookmarkedPacks.map((event) => ({
      type: "pack" as const,
      event,
    }));

    if (refList.length === 0) {
      itemsFromPacks.sort((a, b) => createdAtOf(b) - createdAtOf(a));
      setItems(itemsFromPacks);
      setInitialLoadDone(true);
      setLoading(false);
      resolvingRef.current = false;
      return;
    }

    const resolved = new Map<string, Event>();
    let settled = false;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;

    const finalize = () => {
      if (settled) return;
      settled = true;
      if (quietTimer) clearTimeout(quietTimer);
      handle.unobserve();
      const next: BookmarkItem[] = [
        ...itemsFromPacks,
        ...refList.map<BookmarkItem>((ref) =>
          resolved.has(ref)
            ? { type: "resolved", ref, event: resolved.get(ref)! }
            : { type: "missing", ref }
        ),
      ];
      next.sort((a, b) => createdAtOf(b) - createdAtOf(a));
      setItems(next);
      setInitialLoadDone(true);
      setLoading(false);
      resolvingRef.current = false;
    };

    const handle = dataLayer.observe(filtersForRefs(refList), {
      onEvent: (event: Event) => {
        if (event.kind === KIND_NOTE && !profiles?.get(event.pubkey)) {
          fetchUserProfileThrottled(event.pubkey);
        }
        for (const ref of refList) {
          if (!resolved.has(ref) && matchRef(ref, event)) {
            resolved.set(ref, event);
            break;
          }
        }
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(finalize, 900);
      },
    });

    // Hard cap so zero-result resolutions still settle.
    setTimeout(finalize, RESOLVE_TIMEOUT_MS);
  }, [refList, bookmarkedPacks, fetchUserProfileThrottled, profiles]);

  useEffect(() => {
    if (user) resolve();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolve, relayRefresh]);

  if (!user) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        minHeight="200px"
        gap={2}
      >
        <Typography variant="body2" color="text.secondary">
          Bookmarks are stored on your account.
        </Typography>
        <Button variant="contained" onClick={requestLogin}>
          login to view bookmarks
        </Button>
      </Box>
    );
  }

  return (
    <UnifiedFeed
      data={items}
      itemContent={(_i, item) => <BookmarksItem item={item} />}
      computeItemKey={(_i, item) => (item.type === "pack" ? item.event.id : item.ref)}
      loading={loading}
      loadingMore={false}
      emptyState={
        initialLoadDone ? (
          <Box display="flex" justifyContent="center" px={3} py={8}>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              No bookmarks yet. Bookmark notes, polls, or articles from anywhere in
              the app.
            </Typography>
          </Box>
        ) : undefined
      }
    />
  );
};

export default BookmarksFeed;
