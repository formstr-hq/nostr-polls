import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Typography, ButtonBase } from "@mui/material";
import QueueMusicIcon from "@mui/icons-material/QueueMusic";
import { Event, nip19 } from "nostr-tools";
import { collectOnce } from "../../dataLayer/collect";
import { useUserContext } from "../../hooks/useUserContext";
import { useAppContext } from "../../hooks/useAppContext";
import { tagValue } from "./musicTrack";
import { KIND_PUBLIC_PLAYLIST } from "./playlistModel";

const CARD = 132;

// Horizontal strip of public playlists (kind 34139) published by people the user
// follows. Hidden when logged out or when nobody you follow has shared one.
const FollowingPlaylists: React.FC = () => {
  const { user } = useUserContext();
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);

  const follows = user?.follows;

  useEffect(() => {
    if (!follows?.length) {
      setEvents([]);
      return;
    }
    let alive = true;
    collectOnce([
      { kinds: [KIND_PUBLIC_PLAYLIST], authors: follows, limit: 50 },
    ]).then((evts) => {
      if (alive) setEvents(evts);
    });
    return () => {
      alive = false;
    };
  }, [follows]);

  // Keep the newest event per addressable coordinate (kind:pubkey:d).
  const playlists = useMemo(() => {
    const byCoord = new Map<string, Event>();
    for (const e of events) {
      const d = tagValue(e, "d") || "";
      if (!d) continue;
      const key = `${e.pubkey}:${d}`;
      const prev = byCoord.get(key);
      if (!prev || e.created_at > prev.created_at) byCoord.set(key, e);
    }
    return Array.from(byCoord.values())
      .filter((e) => e.tags.some((t) => t[0] === "a")) // skip empty playlists
      .sort((a, b) => b.created_at - a.created_at);
  }, [events]);

  useEffect(() => {
    playlists.forEach((e) => {
      if (!profiles?.get(e.pubkey)) fetchUserProfileThrottled(e.pubkey);
    });
  }, [playlists, profiles, fetchUserProfileThrottled]);

  if (!user || playlists.length === 0) return null;

  const open = (e: Event) => {
    const naddr = nip19.naddrEncode({
      kind: KIND_PUBLIC_PLAYLIST,
      pubkey: e.pubkey,
      identifier: tagValue(e, "d") || "",
    });
    navigate(`/feeds/music/shared/${naddr}`);
  };

  return (
    <Box sx={{ px: 2, pt: 1, pb: 1 }}>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
        From people you follow
      </Typography>
      <Box
        sx={{
          display: "flex",
          gap: 1.5,
          overflowX: "auto",
          pb: 1,
          scrollbarWidth: "thin",
        }}
      >
        {playlists.map((e) => {
          const title = tagValue(e, "title") || "Untitled playlist";
          const image = tagValue(e, "image");
          const trackCount = e.tags.filter((t) => t[0] === "a").length;
          const author = profiles?.get(e.pubkey);
          const authorName =
            author?.name ||
            author?.display_name ||
            nip19.npubEncode(e.pubkey).slice(0, 10) + "…";
          return (
            <ButtonBase
              key={`${e.pubkey}:${tagValue(e, "d")}`}
              onClick={() => open(e)}
              sx={{
                width: CARD,
                flexShrink: 0,
                display: "block",
                textAlign: "left",
                borderRadius: 2,
              }}
            >
              <Box
                sx={{
                  width: CARD,
                  height: CARD,
                  borderRadius: 2,
                  overflow: "hidden",
                  bgcolor: "action.hover",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {image ? (
                  <Box
                    component="img"
                    src={image}
                    alt={title}
                    sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <QueueMusicIcon color="disabled" sx={{ fontSize: 48 }} />
                )}
              </Box>
              <Typography variant="body2" noWrap sx={{ mt: 0.5, fontWeight: 600 }}>
                {title}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                by {authorName}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                {trackCount} {trackCount === 1 ? "track" : "tracks"}
              </Typography>
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  );
};

export default FollowingPlaylists;
