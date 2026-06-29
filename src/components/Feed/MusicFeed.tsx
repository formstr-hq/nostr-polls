import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Event } from "nostr-tools";
import { Box, Typography } from "@mui/material";
import { Scope } from "@formstr/local-relay";
import { useUserContext } from "../../hooks/useUserContext";
import { useSubNav } from "../../contexts/SubNavContext";
import { useEvents } from "../../dataLayer/hooks";
import { MusicCard, KIND_MUSIC } from "../Music/MusicCard";
import LocalMusic from "../Music/LocalMusic";
import PlaylistStrip from "../Music/PlaylistStrip";
import FollowingPlaylists from "../Music/FollowingPlaylists";
import { eventToPlaybackTrack } from "../Music/musicTrack";
import { usePlayback, PlaybackTrack } from "../../contexts/PlaybackContext";
import { safeSetItem } from "../../utils/localStorage";
import UnifiedFeed from "./UnifiedFeed";

const STORAGE_KEY = "pollerama:musicSource";

// The playlist strips that sit at the top of every music tab. Defined at module
// scope (a stable reference) so Virtuoso's Header slot never remounts it on
// re-render — which would reset the strips' horizontal scroll and refetch.
const MusicHeader: React.FC = () => (
  <>
    <PlaylistStrip />
    <FollowingPlaylists />
  </>
);

// "discover" = global tracks, "following" = tracks from people you follow,
// "local" = files on this device (no Nostr). Only the first two hit relays.
type Source = "discover" | "following" | "local";

// The Nostr-backed music tabs (discover/following). Split into its own component
// so the data-layer hook is only active for the network tabs — and so swapping
// `source` re-declares the interest cleanly. Pagination is the worker's job:
// `loadOlder` widens the window and it syncs more, so reaching the end always
// pulls the next page (no fragile client-side "exhausted" heuristic).
const MusicNostrFeed: React.FC<{ source: "discover" | "following" }> = ({
  source,
}) => {
  const { playQueue } = usePlayback();

  const scope: Scope =
    source === "following" ? { type: "following" } : { type: "global" };

  const { items, loadOlder, loading } = useEvents({
    kinds: [KIND_MUSIC],
    scope,
    includeNonRoots: true, // music tracks are standalone, never "replies"
  });

  const tracks = useMemo(
    () => items.filter((e) => e.kind === KIND_MUSIC),
    [items]
  );

  // Start playback from a feed card with the whole feed loaded as a queue, so the
  // MiniPlayer's next/prev walk the list instead of playing one track in isolation.
  const playFromFeed = useCallback(
    (startEventId: string) => {
      const queue: PlaybackTrack[] = [];
      let startAt = 0;
      for (const ev of tracks) {
        const pt = eventToPlaybackTrack(ev);
        if (!pt) continue;
        if (ev.id === startEventId) startAt = queue.length;
        queue.push(pt);
      }
      if (queue.length) playQueue(queue, startAt);
    },
    [tracks, playQueue]
  );

  const renderItem = useCallback(
    (_index: number, track: Event) => (
      <Box sx={{ maxWidth: 700, mx: "auto" }}>
        <MusicCard event={track} onPlay={() => playFromFeed(track.id)} />
      </Box>
    ),
    [playFromFeed]
  );

  const computeKey = useCallback((_index: number, track: Event) => track.id, []);

  return (
    <UnifiedFeed
      data={tracks}
      itemContent={renderItem}
      computeItemKey={computeKey}
      ListHeader={MusicHeader}
      loading={false}
      loadingMore={loading}
      onEndReached={loadOlder}
      emptyState={
        !loading ? (
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

const MusicFeed: React.FC = () => {
  const { user } = useUserContext();
  const { setItems, clearItems } = useSubNav();

  const savedSource = (localStorage.getItem(STORAGE_KEY) as Source) || "discover";
  const [source, setSource] = useState<Source>(savedSource);

  useEffect(() => {
    const select = (s: Source) => {
      // setSource first: switching tabs must work even if persisting the
      // preference fails (a full localStorage quota throws — see safeSetItem).
      setSource(s);
      safeSetItem(STORAGE_KEY, s);
    };

    setItems([
      { key: "discover",  label: "Discover",  active: source === "discover",  onClick: () => select("discover") },
      { key: "following", label: "Following", active: source === "following", disabled: !user, onClick: () => select("following") },
      { key: "local",     label: "Local",     active: source === "local",     onClick: () => select("local") },
    ]);

    return () => clearItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, user]);

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {source === "local" ? (
          <LocalMusic header={<MusicHeader />} />
        ) : (
          <MusicNostrFeed source={source} />
        )}
      </Box>
    </Box>
  );
};

export default MusicFeed;
