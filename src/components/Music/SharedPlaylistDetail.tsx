import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Avatar,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  IconButton,
  List,
  ListItemButton,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import QueueMusicIcon from "@mui/icons-material/QueueMusic";
import BookmarkAddIcon from "@mui/icons-material/BookmarkAdd";
import { Event, nip19 } from "nostr-tools";
import { dataLayer } from "@formstr/local-relay";
import { collectOnce } from "../../dataLayer/collect";
import { usePlayback, PlaybackTrack } from "../../contexts/PlaybackContext";
import { usePlaylists } from "../../contexts/playlists-context";
import { useAppContext } from "../../hooks/useAppContext";
import {
  KIND_MUSIC,
  tagValue,
  trackCoord,
  eventToPlaybackTrack,
} from "./musicTrack";
import {
  KIND_PUBLIC_PLAYLIST,
  NostrTrackRef,
  aTagToTrackRef,
  coordDTag,
} from "./playlistModel";
import Zap from "../Common/Zaps/zaps";

const formatDuration = (ms?: number): string => {
  if (!ms || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const shuffleArray = <T,>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

interface Row {
  coord: string;
  event?: Event;
}

// Read-only view of a public Nostr playlist (kind 34139) — e.g. one shared by
// someone you follow. Resolves its `a` track coordinates to playable tracks and
// lets you play them or save a local copy. No editing of someone else's playlist.
const SharedPlaylistDetail: React.FC = () => {
  const { naddr } = useParams<{ naddr: string }>();
  const navigate = useNavigate();
  const { current, playing, playQueue, toggle } = usePlayback();
  const { createPlaylist, addTrack } = usePlaylists();
  const { profiles, fetchUserProfileThrottled } = useAppContext();

  const decoded = useMemo(() => {
    if (!naddr) return null;
    try {
      const d = nip19.decode(naddr);
      if (d.type !== "naddr") return null;
      return d.data;
    } catch {
      return null;
    }
  }, [naddr]);

  const [playlistEvent, setPlaylistEvent] = useState<Event | null>(null);
  const [events, setEvents] = useState<Map<string, Event>>(new Map());
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);

  // Fetch the playlist event itself.
  useEffect(() => {
    if (!decoded) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    collectOnce([
      {
        kinds: [KIND_PUBLIC_PLAYLIST],
        authors: [decoded.pubkey],
        "#d": [decoded.identifier],
        limit: 1,
      },
    ]).then((evts) => {
      if (!alive) return;
      setPlaylistEvent(evts[0] ?? null);
      setLoading(false);
      if (decoded.pubkey && !profiles?.get(decoded.pubkey)) {
        fetchUserProfileThrottled(decoded.pubkey);
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded]);

  // The playlist's tracks as refs, preserving each `a` tag's relay hint.
  const trackRefs: NostrTrackRef[] = useMemo(
    () =>
      playlistEvent
        ? playlistEvent.tags
            .filter((t) => t[0] === "a" && t[1])
            .map(aTagToTrackRef)
        : [],
    [playlistEvent]
  );

  // Fetch the track events for the playlist's coordinates. Music tracks often
  // live on niche relays (e.g. Wavlake) that aren't in the track author's NIP-65
  // outbox, so an author-scoped read would never find them. Instead we seed the
  // playlist's relay hints into the gossip pool and read author-LESS (kind + d),
  // which the worker routes to user relays ∪ the gossip pool — mirroring how
  // NaddrHandlers resolves a single addressable music event.
  useEffect(() => {
    if (!trackRefs.length) return;
    let alive = true;
    trackRefs.forEach((r) => {
      if (r.relay) dataLayer.addGossipRelay(r.relay);
    });
    const dTags = trackRefs.map((r) => coordDTag(r.coord)).filter(Boolean);
    collectOnce([{ kinds: [KIND_MUSIC], "#d": dTags }]).then((evts) => {
      if (!alive) return;
      const map = new Map<string, Event>();
      for (const e of evts) map.set(trackCoord(e), e);
      setEvents(map);
    });
    return () => {
      alive = false;
    };
  }, [trackRefs]);

  const rows: Row[] = useMemo(
    () => trackRefs.map((r) => ({ coord: r.coord, event: events.get(r.coord) })),
    [trackRefs, events]
  );

  const buildQueue = useCallback((): {
    queue: PlaybackTrack[];
    indexByRow: Map<number, number>;
  } => {
    const queue: PlaybackTrack[] = [];
    const indexByRow = new Map<number, number>();
    rows.forEach((r, i) => {
      if (!r.event) return;
      const pt = eventToPlaybackTrack(r.event);
      if (!pt) return;
      indexByRow.set(i, queue.length);
      queue.push(pt);
    });
    return { queue, indexByRow };
  }, [rows]);

  const playAll = useCallback(
    (doShuffle: boolean) => {
      const { queue } = buildQueue();
      if (queue.length) playQueue(doShuffle ? shuffleArray(queue) : queue, 0);
    },
    [buildQueue, playQueue]
  );

  const onRowClick = useCallback(
    (rowIndex: number) => {
      const r = rows[rowIndex];
      if (!r.event) return;
      if (current && current.id === r.coord) {
        toggle();
        return;
      }
      const { queue, indexByRow } = buildQueue();
      const start = indexByRow.get(rowIndex) ?? 0;
      if (queue.length) playQueue(queue, start);
    },
    [rows, current, toggle, buildQueue, playQueue]
  );

  const title = playlistEvent ? tagValue(playlistEvent, "title") || "Untitled playlist" : "";
  const image = playlistEvent ? tagValue(playlistEvent, "image") : undefined;
  const description = playlistEvent
    ? tagValue(playlistEvent, "description") || playlistEvent.content || undefined
    : undefined;
  const owner = decoded ? profiles?.get(decoded.pubkey) : undefined;
  const ownerName =
    owner?.name ||
    owner?.display_name ||
    (decoded ? nip19.npubEncode(decoded.pubkey).slice(0, 12) + "…" : undefined);

  const openOwnerProfile = useCallback(() => {
    if (!decoded) return;
    navigate(`/profile/${nip19.npubEncode(decoded.pubkey)}`);
  }, [decoded, navigate]);

  // Save a local, editable copy of this shared playlist.
  const saveCopy = useCallback(async () => {
    if (!playlistEvent) return;
    setResolving(true);
    try {
      const pl = await createPlaylist(title, image);
      // Keep each track's relay hint so the saved copy resolves the same way.
      for (const ref of trackRefs) {
        await addTrack(pl.id, ref);
      }
      setSaved(true);
      setSnack("Saved to your playlists.");
    } catch {
      setSnack("Couldn't save the playlist.");
    } finally {
      setResolving(false);
    }
  }, [playlistEvent, title, image, trackRefs, createPlaylist, addTrack]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" py={8}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (!playlistEvent) {
    return (
      <Box p={3}>
        <Stack direction="row" alignItems="center" spacing={1} mb={2}>
          <IconButton onClick={() => navigate(-1)} aria-label="Back">
            <ArrowBackIcon />
          </IconButton>
        </Stack>
        <Typography color="text.secondary">Playlist not found.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 700, mx: "auto", height: "100%", overflowY: "auto" }}>
      <Box sx={{ p: 2 }}>
        <Stack direction="row" alignItems="flex-start" spacing={2}>
          <IconButton onClick={() => navigate(-1)} aria-label="Back" sx={{ mt: 0.5 }}>
            <ArrowBackIcon />
          </IconButton>
          <Box
            sx={{
              width: 96,
              height: 96,
              borderRadius: 2,
              overflow: "hidden",
              bgcolor: "action.hover",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {image ? (
              <Box component="img" src={image} alt={title} sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <QueueMusicIcon color="disabled" sx={{ fontSize: 40 }} />
            )}
          </Box>
          <Box minWidth={0} flex={1}>
            <Typography variant="h6" noWrap sx={{ fontWeight: 700 }}>
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {trackRefs.length} {trackRefs.length === 1 ? "track" : "tracks"}
            </Typography>
            <ButtonBase
              onClick={openOwnerProfile}
              sx={{
                mt: 0.75,
                borderRadius: 4,
                px: 0.5,
                py: 0.25,
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                maxWidth: "100%",
              }}
            >
              <Avatar
                src={owner?.picture}
                sx={{ width: 22, height: 22, fontSize: "0.7rem" }}
              >
                {ownerName?.[0]?.toUpperCase()}
              </Avatar>
              <Typography variant="body2" color="text.secondary" noWrap>
                by <strong>{ownerName}</strong>
              </Typography>
            </ButtonBase>
            <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap alignItems="center">
              <Button
                variant="contained"
                size="small"
                startIcon={<PlayArrowIcon />}
                onClick={() => playAll(false)}
                disabled={trackRefs.length === 0}
                sx={{ textTransform: "none", borderRadius: 2 }}
              >
                Play all
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<ShuffleIcon />}
                onClick={() => playAll(true)}
                disabled={trackRefs.length === 0}
                sx={{ textTransform: "none", borderRadius: 2 }}
              >
                Shuffle
              </Button>
              <Button
                variant="text"
                size="small"
                startIcon={<BookmarkAddIcon />}
                onClick={saveCopy}
                disabled={resolving || saved}
                sx={{ textTransform: "none", borderRadius: 2 }}
              >
                {saved ? "Saved" : "Save"}
              </Button>
              {/* Zaps the playlist's creator, tagging this kind-34139 event. */}
              <Zap pollEvent={playlistEvent} />
            </Stack>
          </Box>
        </Stack>
        {description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            {description}
          </Typography>
        )}
      </Box>

      <List dense disablePadding sx={{ px: 1, pb: 2 }}>
        {rows.map((r, i) => {
          const ev = r.event;
          const isCurrent = !!current && current.id === r.coord;
          const titleText = ev ? tagValue(ev, "title") || ev.content || "Untitled track" : "Loading…";
          const artist = ev ? tagValue(ev, "artist") || tagValue(ev, "creator") : undefined;
          const cover = ev ? tagValue(ev, "image") || tagValue(ev, "cover") : undefined;
          const durationMs = ev ? (Number(tagValue(ev, "duration")) || 0) * 1000 || undefined : undefined;
          const duration = formatDuration(durationMs);
          return (
            <ListItemButton
              key={r.coord}
              selected={isCurrent}
              disabled={!ev}
              onClick={() => onRowClick(i)}
              sx={{ borderRadius: 1, gap: 1, opacity: ev ? 1 : 0.5 }}
            >
              <Box sx={{ position: "relative", width: 44, height: 44, flexShrink: 0 }}>
                {cover ? (
                  <Box component="img" src={cover} alt="" sx={{ width: 44, height: 44, borderRadius: 1, objectFit: "cover", display: "block" }} />
                ) : (
                  <Box sx={{ width: 44, height: 44, borderRadius: 1, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "action.hover" }}>
                    <MusicNoteIcon color="disabled" fontSize="small" />
                  </Box>
                )}
                {isCurrent && (
                  <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 1, bgcolor: "rgba(0,0,0,0.45)", color: "common.white" }}>
                    {playing ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
                  </Box>
                )}
              </Box>
              <Box minWidth={0} flex={1}>
                <Typography variant="body2" noWrap sx={{ fontWeight: isCurrent ? 600 : 400 }}>
                  {titleText}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                  {ev ? artist || "" : "Loading…"}
                </Typography>
              </Box>
              {duration && (
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {duration}
                </Typography>
              )}
            </ListItemButton>
          );
        })}
      </List>

      <Snackbar
        open={Boolean(snack)}
        autoHideDuration={4000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="info" onClose={() => setSnack(null)} sx={{ width: "100%" }}>
          {snack}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default SharedPlaylistDetail;
