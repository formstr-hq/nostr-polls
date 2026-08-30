import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Event, Filter, nip19 } from "nostr-tools";
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
// event resolved from a public NIP-51 ref.
type BookmarkItem =
  | { type: "pack"; event: Event }
  | { type: "resolved"; ref: string; event: Event }
  | { type: "missing"; ref: string };

const KIND_NOTE = 1;
const KIND_POLL = 1068;
const KIND_ARTICLE = 30023;
const KIND_PACK = 39089;

const RESOLVE_TIMEOUT_MS = 5000;

// Refs follow the NIP-51 bookmark shape produced by `eventRefOf` in
// lists-context: a bare 64-hex id (plain events, stored as `e` tags) or a
// canonical `kind:pubkey:identifier` a-ref (addressable kinds).
const HEX_ID = /^[0-9a-f]{64}$/i;

type RefParts = { kind: number; pubkey: string; identifier: string } | null;

const refParts = (ref: string): RefParts => {
  const [kind, pubkey, ...rest] = ref.split(":");
  const identifier = rest.join(":");
  if (!/^\d+$/.test(kind) || !pubkey || !identifier) return null;
  return { kind: Number(kind), pubkey, identifier };
};

const matchRef = (ref: string, event: Event): boolean => {
  if (HEX_ID.test(ref)) return event.id === ref;
  const parts = refParts(ref);
  if (!parts) return false;
  return (
    event.kind === parts.kind &&
    event.pubkey === parts.pubkey &&
    event.tags.some((t) => t[0] === "d" && t[1] === parts.identifier)
  );
};

const filtersForRefs = (refs: string[]): Filter[] => {
  const ids = refs.filter((r) => HEX_ID.test(r));
  const filters: Filter[] = [];
  if (ids.length) filters.push({ ids, limit: ids.length });
  for (const ref of refs) {
    const parts = refParts(ref);
    if (parts) {
      filters.push({ kinds: [parts.kind], authors: [parts.pubkey], "#d": [parts.identifier], limit: 1 });
    }
  }
  return filters;
};

// Kinds this client can render in the bookmarks feed. `eventRefOf` bookmarks
// anything, so anything unlisted here (and addressable kinds without a card)
// falls through to the generic note renderer.
// Single place to extend when a new bookmarkable kind gains a renderer.
const KIND_RENDERERS: Record<number, (event: Event) => React.ReactNode> = {
  [KIND_POLL]: (event) => <PollResponseForm pollEvent={event} />,
  [KIND_ARTICLE]: (event) => <ArticleCard event={event} />,
  [KIND_MUSIC]: (event) => <MusicCard event={event} />,
};

const createdAtOf = (item: BookmarkItem) =>
  item.type === "missing" ? 0 : item.event.created_at;

// Friendly rendering for refs that no longer resolve (deleted events, relays
// unreachable, or legacy refs pointing at gone content): a truncated npub
// plus a link to an external explorer for the full id.
const MissingBookmark = ({ refString }: { refString: string }) => {
  const parts = refParts(refString);
  const npub = parts ? nip19.nprofileEncode({ pubkey: parts.pubkey }) : null;
  const short = npub ? `${npub.slice(0, 10)}…${npub.slice(-6)}` : refString.slice(0, 16);
  const explorerUrl = HEX_ID.test(refString)
    ? `https://nostr.band/${refString}`
    : parts
    ? `https://nostr.band/${nip19.npubEncode(parts.pubkey)}`
    : null;
  return (
    <Box sx={{ p: 2, borderRadius: 2, border: 1, borderColor: "divider" }}>
      <Typography variant="body2" color="text.secondary">
        {parts
          ? `Bookmark for a kind ${parts.kind} event by ${short}`
          : `Bookmark ${short}`}{" "}
        is no longer resolvable.
        {explorerUrl && (
          <Button
            size="small"
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ ml: 1, textTransform: "none", fontSize: "0.75rem" }}
          >
            Open in explorer
          </Button>
        )}
      </Typography>
    </Box>
  );
};

const BookmarksItem = React.memo(({ item }: { item: BookmarkItem }) => {
  let inner: React.ReactNode;
  if (item.type === "pack") {
    inner = <FollowPackCard event={item.event} />;
  } else if (item.type === "missing") {
    inner = <MissingBookmark refString={item.ref} />;
  } else {
    const { event } = item;
    inner = KIND_RENDERERS[event.kind]?.(event) ?? <Notes event={event} />;
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

  // The resolve effect reads profiles only to skip redundant author fetches —
  // tracking it in a ref keeps the (expensive) resolve callback from being
  // rebuilt every time any profile arrives.
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;

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
        if (event.kind === KIND_NOTE && !profilesRef.current?.get(event.pubkey)) {
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
  }, [refList, bookmarkedPacks, fetchUserProfileThrottled]);

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
