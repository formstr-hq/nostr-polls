import React, { useCallback, useEffect, useRef, useState } from "react";
import { Event, Filter } from "nostr-tools";
import { Box, Typography } from "@mui/material";
import { useRelays } from "../../hooks/useRelays";
import { dataLayer } from "@formstr/local-relay";
import { useUserContext } from "../../hooks/useUserContext";
import { useSubNav } from "../../contexts/SubNavContext";
import { useAppContext } from "../../hooks/useAppContext";
import { MusicCard, KIND_MUSIC } from "../Music/MusicCard";
import LocalMusic from "../Music/LocalMusic";
import UnifiedFeed from "./UnifiedFeed";

const STORAGE_KEY = "pollerama:musicSource";
const BATCH_SIZE = 20;

// "discover" = global tracks, "following" = tracks from people you follow,
// "local" = files on this device (no Nostr). Only the first two hit relays.
type Source = "discover" | "following" | "local";

const MusicFeed: React.FC = () => {
  const { relays } = useRelays();
  const { user } = useUserContext();
  const { fetchUserProfileThrottled, profiles } = useAppContext();
  const { setItems, clearItems } = useSubNav();

  const savedSource = (localStorage.getItem(STORAGE_KEY) as Source) || "discover";
  const [source, setSource] = useState<Source>(savedSource);
  const [tracks, setTracks] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const cursorRef = useRef<number | undefined>(undefined);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const select = (s: Source) => {
      localStorage.setItem(STORAGE_KEY, s);
      setSource(s);
      setTracks([]);
      seen.current.clear();
      cursorRef.current = undefined;
      setInitialLoadDone(false);
      setExhausted(false);
    };

    setItems([
      { key: "discover",  label: "Discover",  active: source === "discover",  onClick: () => select("discover") },
      { key: "following", label: "Following", active: source === "following", disabled: !user, onClick: () => select("following") },
      { key: "local",     label: "Local",     active: source === "local",     onClick: () => select("local") },
    ]);

    return () => clearItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, user]);

  const fetchBatch = useCallback((isInitial: boolean) => {
    if (exhausted) return;
    if (isInitial) setLoading(true); else setLoadingMore(true);

    const now = Math.floor(Date.now() / 1000);
    const newTracks: Event[] = [];
    let oldestTs: number | undefined;

    const filter: Filter = {
      kinds: [KIND_MUSIC],
      limit: BATCH_SIZE,
      until: cursorRef.current ?? now,
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
          newTracks.push(event);
          if (!profiles?.get(event.pubkey)) fetchUserProfileThrottled(event.pubkey);
        }
        if (!oldestTs || event.created_at < oldestTs) oldestTs = event.created_at;
        // Commit shortly after the stream goes quiet (local EOSE is not
        // completion under the dataLayer contract — upstream arrives later).
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(finalize, 900);
      },
    });

    const finalize = () => {
      if (settled) return;
      settled = true;
      if (quietTimer) clearTimeout(quietTimer);
      handle.unobserve();
      if (newTracks.length < BATCH_SIZE) setExhausted(true);
      if (oldestTs) cursorRef.current = oldestTs - 1;
      setTracks((prev) => {
        const ids = new Set(prev.map((e) => e.id));
        const merged = [...prev, ...newTracks.filter((e) => !ids.has(e.id))];
        merged.sort((a, b) => b.created_at - a.created_at);
        return merged;
      });
      setInitialLoadDone(true);
      setLoading(false);
      setLoadingMore(false);
    };

    // Hard cap so an empty result (no events → no quiet timer) still settles.
    setTimeout(finalize, 5000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, relays, exhausted]);

  useEffect(() => {
    if (source === "local") return;
    fetchBatch(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const handleEndReached = useCallback(() => {
    if (!loadingMore && !loading && initialLoadDone && !exhausted) {
      fetchBatch(false);
    }
  }, [loadingMore, loading, initialLoadDone, exhausted, fetchBatch]);

  const renderItem = useCallback((_index: number, track: Event) => (
    <Box sx={{ maxWidth: 700, mx: "auto" }}>
      <MusicCard event={track} />
    </Box>
  ), []);

  const computeKey = useCallback((_index: number, track: Event) => track.id, []);

  if (source === "local") {
    return <LocalMusic />;
  }

  return (
    <UnifiedFeed
      data={tracks}
      itemContent={renderItem}
      computeItemKey={computeKey}
      loading={false}
      loadingMore={loading || loadingMore}
      onEndReached={handleEndReached}
      emptyState={
        initialLoadDone ? (
          <Box display="flex" justifyContent="center" px={3} py={8}>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              {source === "following"
                ? "No tracks found from people you follow."
                : "No tracks found."}
            </Typography>
          </Box>
        ) : undefined
      }
    />
  );
};

export default MusicFeed;
