import React, { useEffect, useRef, useState } from "react";
import { Event, Filter } from "nostr-tools";
import { Box, Button, CircularProgress, Typography } from "@mui/material";
import { dataLayer } from "@formstr/local-relay";
import { useUserContext } from "../../hooks/useUserContext";
import { useListContext } from "../../hooks/useListContext";
import { useSubNav } from "../../contexts/SubNavContext";
import { FollowPackCard } from "../FollowPacks/FollowPackCard";
import { WhoToFollow } from "../Profile/WhoToFollow";

const STORAGE_KEY = "pollerama:followPacksSource";
const BATCH_SIZE = 20;

type Source = "global" | "following" | "bookmarked";

const FollowPacksFeed: React.FC = () => {
  const { user } = useUserContext();
  const { lists, bookmarkedPackKeys } = useListContext();
  const { setItems, clearItems } = useSubNav();

  const savedSource = (localStorage.getItem(STORAGE_KEY) as Source) || "global";
  const [source, setSource] = useState<Source>(savedSource);
  const [packs, setPacks] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const seen = useRef<Set<string>>(new Set());

  // Bookmarked packs come straight from context — no relay fetch needed
  const bookmarkedPacks = Array.from(lists?.entries() || [])
    .filter(([key, e]) => e.kind === 39089 && bookmarkedPackKeys.has(key))
    .map(([, e]) => e)
    .sort((a, b) => b.created_at - a.created_at);

  // Register sub-nav items
  useEffect(() => {
    const select = (s: Source) => {
      localStorage.setItem(STORAGE_KEY, s);
      setSource(s);
      setPacks([]);
      seen.current.clear();
      setCursor(undefined);
      setInitialLoadComplete(false);
    };

    setItems([
      {
        key: "global",
        label: "Global",
        active: source === "global",
        onClick: () => select("global"),
      },
      {
        key: "following",
        label: "Following",
        active: source === "following",
        disabled: !user,
        onClick: () => select("following"),
      },
      {
        key: "bookmarked",
        label: "Bookmarked",
        active: source === "bookmarked",
        disabled: !user,
        onClick: () => select("bookmarked"),
      },
    ]);

    return () => clearItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, user]);

  const fetchBatch = () => {
    if (loading || source === "bookmarked") return;
    setLoading(true);

    const now = Math.floor(Date.now() / 1000);
    const newPacks: Event[] = [];
    let oldestTimestamp: number | undefined;

    const filter: Filter = {
      kinds: [39089],
      limit: BATCH_SIZE,
      until: cursor ?? now,
    };

    if (source === "following" && user?.follows?.length) {
      filter.authors = user.follows;
    }

    let settled = false;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;

    const handle = dataLayer.observe([filter], {
      onEvent: (event: Event) => {
        if (!seen.current.has(event.id)) {
          seen.current.add(event.id);
          newPacks.push(event);
        }
        if (!oldestTimestamp || event.created_at < oldestTimestamp) {
          oldestTimestamp = event.created_at;
        }
        // Commit shortly after the stream goes quiet (local EOSE precedes the
        // worker's upstream fetch under the dataLayer contract).
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(finalize, 900);
      },
    });

    const finalize = () => {
      if (settled) return;
      settled = true;
      if (quietTimer) clearTimeout(quietTimer);
      handle.unobserve();
      setPacks((prev) => {
        const ids = new Set(prev.map((e) => e.id));
        const merged = [...prev, ...newPacks.filter((e) => !ids.has(e.id))];
        merged.sort((a, b) => b.created_at - a.created_at);
        return merged;
      });
      if (oldestTimestamp) setCursor(oldestTimestamp - 1);
      setInitialLoadComplete(true);
      setLoading(false);
    };

    // Hard cap so an empty result (no events → no quiet timer) still settles.
    setTimeout(finalize, 5000);
  };

  useEffect(() => {
    if (source !== "bookmarked") fetchBatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const displayPacks = source === "bookmarked" ? bookmarkedPacks : packs;
  const isLoading = source === "bookmarked" ? false : loading;
  const isDone = source === "bookmarked" ? true : initialLoadComplete;

  const emptyMessage =
    source === "bookmarked"
      ? "No bookmarked packs yet. Bookmark packs from the Global or Following feeds."
      : source === "following"
      ? "No follow packs found from people you follow."
      : "No follow packs found.";

  return (
    <Box sx={{ height: "100%", overflowY: "auto" }}>
      {/* Algorithmic follow suggestions sit atop the discovery (Global) tab —
          packs are curated lists to follow, so "people you may know" fits here.
          Renders nothing until the WoT worker has produced recommendations. */}
      {source === "global" && <WhoToFollow />}
      {isLoading && displayPacks.length === 0 ? (
        <Box display="flex" justifyContent="center" py={8}>
          <CircularProgress />
        </Box>
      ) : displayPacks.length === 0 && isDone ? (
        <Box display="flex" justifyContent="center" px={3} py={8}>
          <Typography variant="body2" color="text.secondary" textAlign="center">
            {emptyMessage}
          </Typography>
        </Box>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr" },
            alignItems: "start",
            maxWidth: 900,
            mx: "auto",
          }}
        >
          {displayPacks.map((pack) => (
            <FollowPackCard key={pack.id} event={pack} />
          ))}
        </Box>
      )}

      {source !== "bookmarked" && initialLoadComplete && packs.length > 0 && (
        <Box display="flex" justifyContent="center" my={2}>
          <Button variant="contained" disabled={loading} onClick={fetchBatch}>
            {loading ? <CircularProgress size={24} /> : "Load More"}
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default FollowPacksFeed;
