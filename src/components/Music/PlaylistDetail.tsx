import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  Menu,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EditIcon from "@mui/icons-material/Edit";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import CloseIcon from "@mui/icons-material/Close";
import QueueMusicIcon from "@mui/icons-material/QueueMusic";
import PublicIcon from "@mui/icons-material/Public";
import { Event } from "nostr-tools";
import { dataLayer } from "@formstr/local-relay";
import { collectOnce } from "../../dataLayer/collect";
import { usePlayback, PlaybackTrack } from "../../contexts/PlaybackContext";
import { usePlaylists } from "../../contexts/playlists-context";
import { useUserContext } from "../../hooks/useUserContext";
import {
  KIND_MUSIC,
  tagValue,
  trackCoord,
  eventToPlaybackTrack,
} from "./musicTrack";
import {
  NostrTrackRef,
  PlaylistTrackRef,
  coordDTag,
  trackRefKey,
} from "./playlistModel";
import { hasFingerprint, resolveByFingerprint } from "./localTrackResolver";

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

// A resolved view of a playlist row for rendering + playback.
interface Row {
  ref: PlaylistTrackRef;
  key: string;
  title: string;
  artist?: string;
  image?: string;
  durationMs?: number;
  available: boolean;
  event?: Event;
}

const PlaylistDetail: React.FC = () => {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  const { playlists, removeTrack, deletePlaylist, publishPlaylist, renamePlaylist } =
    usePlaylists();
  const { user, requestLogin } = useUserContext();
  const { current, playing, playQueue, toggle } = usePlayback();

  const playlist = playlistId ? playlists?.get(playlistId) : undefined;

  // coord → fetched track event; fingerprint → available-on-this-device.
  const [events, setEvents] = useState<Map<string, Event>>(new Map());
  const [localAvail, setLocalAvail] = useState<Map<string, boolean>>(new Map());
  const [resolving, setResolving] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [renameValue, setRenameValue] = useState<string | null>(null);
  const [snack, setSnack] = useState<string | null>(null);
  // fingerprint → resolved store id, learned after a local track is first played.
  const localIdByFp = useRef<Map<string, string>>(new Map());

  // Fetch the Nostr track events + probe which local files exist on this device.
  useEffect(() => {
    if (!playlist) return;
    let alive = true;

    const nostrRefs = playlist.tracks.filter(
      (t): t is NostrTrackRef => t.type === "nostr"
    );
    if (nostrRefs.length) {
      // Seed any stored relay hints into the gossip pool, then read author-LESS
      // (kind + d) so the worker can reach niche relays that host these tracks —
      // an author-scoped read is outbox-partitioned and would skip the gossip
      // pool, leaving tracks stuck on "Loading…".
      nostrRefs.forEach((r) => {
        if (r.relay) dataLayer.addGossipRelay(r.relay);
      });
      const dTags = nostrRefs.map((r) => coordDTag(r.coord)).filter(Boolean);
      collectOnce([{ kinds: [KIND_MUSIC], "#d": dTags }]).then((evts) => {
        if (!alive) return;
        const map = new Map<string, Event>();
        for (const e of evts) map.set(trackCoord(e), e);
        setEvents(map);
      });
    }

    void (async () => {
      const avail = new Map<string, boolean>();
      for (const t of playlist.tracks) {
        if (t.type === "local") avail.set(t.fingerprint, await hasFingerprint(t.fingerprint));
      }
      if (alive) setLocalAvail(avail);
    })();

    return () => {
      alive = false;
    };
  }, [playlist]);

  const rows: Row[] = useMemo(() => {
    if (!playlist) return [];
    return playlist.tracks.map((ref) => {
      if (ref.type === "nostr") {
        const ev = events.get(ref.coord);
        return {
          ref,
          key: trackRefKey(ref),
          title: ev ? tagValue(ev, "title") || ev.content || "Untitled track" : "Loading…",
          artist: ev ? tagValue(ev, "artist") || tagValue(ev, "creator") : undefined,
          image: ev ? tagValue(ev, "image") || tagValue(ev, "cover") : undefined,
          durationMs: ev ? (Number(tagValue(ev, "duration")) || 0) * 1000 || undefined : undefined,
          available: !!ev,
          event: ev,
        };
      }
      return {
        ref,
        key: trackRefKey(ref),
        title: ref.title,
        artist: ref.artist,
        durationMs: ref.durationMs,
        available: localAvail.get(ref.fingerprint) ?? false,
      };
    });
  }, [playlist, events, localAvail]);

  // Build a playback queue from the available rows, resolving local files in
  // parallel within the click gesture (so FSA permission prompts work).
  const buildQueue = useCallback(async (): Promise<{
    queue: PlaybackTrack[];
    queueIndexByRow: Map<number, number>;
  }> => {
    const localResolved = await Promise.all(
      rows.map((r) =>
        r.ref.type === "local" && r.available
          ? resolveByFingerprint(r.ref.fingerprint)
          : Promise.resolve(null)
      )
    );
    const queue: PlaybackTrack[] = [];
    const queueIndexByRow = new Map<number, number>();
    rows.forEach((r, i) => {
      if (r.ref.type === "nostr") {
        if (!r.event) return;
        const pt = eventToPlaybackTrack(r.event);
        if (!pt) return;
        queueIndexByRow.set(i, queue.length);
        queue.push(pt);
      } else {
        const resolved = localResolved[i];
        if (!resolved) return;
        localIdByFp.current.set(r.ref.fingerprint, resolved.id);
        queueIndexByRow.set(i, queue.length);
        queue.push({
          id: resolved.id,
          sources: [resolved.url],
          title: r.title,
          artist: r.artist,
        });
      }
    });
    return { queue, queueIndexByRow };
  }, [rows]);

  const playAll = useCallback(
    async (doShuffle: boolean) => {
      setResolving(true);
      try {
        const { queue } = await buildQueue();
        if (queue.length) playQueue(doShuffle ? shuffleArray(queue) : queue, 0);
      } finally {
        setResolving(false);
      }
    },
    [buildQueue, playQueue]
  );

  const isRowCurrent = useCallback(
    (r: Row): boolean => {
      if (!current) return false;
      if (r.ref.type === "nostr") return current.id === r.ref.coord;
      return current.id === localIdByFp.current.get(r.ref.fingerprint);
    },
    [current]
  );

  const onRowClick = useCallback(
    async (rowIndex: number) => {
      const r = rows[rowIndex];
      if (!r.available) return;
      if (isRowCurrent(r)) {
        toggle();
        return;
      }
      setResolving(true);
      try {
        const { queue, queueIndexByRow } = await buildQueue();
        const start = queueIndexByRow.get(rowIndex) ?? 0;
        if (queue.length) playQueue(queue, start);
      } finally {
        setResolving(false);
      }
    },
    [rows, isRowCurrent, toggle, buildQueue, playQueue]
  );

  const localCount = playlist
    ? playlist.tracks.filter((t) => t.type === "local").length
    : 0;
  const shareableCount = playlist ? playlist.tracks.length - localCount : 0;

  const startPublish = () => {
    setMenuAnchor(null);
    if (!user) {
      requestLogin();
      return;
    }
    setConfirmPublish(true);
  };

  const doPublish = async () => {
    if (!playlist) return;
    setPublishing(true);
    try {
      const { removedLocalCount } = await publishPlaylist(playlist.id);
      setConfirmPublish(false);
      setSnack(
        removedLocalCount > 0
          ? `Published. ${removedLocalCount} local ${
              removedLocalCount === 1 ? "song was" : "songs were"
            } left out.`
          : "Playlist published."
      );
    } catch {
      setSnack("Couldn't publish the playlist.");
    } finally {
      setPublishing(false);
    }
  };

  if (playlists && !playlist) {
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

  if (!playlist) {
    return (
      <Box display="flex" justifyContent="center" py={8}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  const trackCount = playlist.tracks.length;

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
            {playlist.image ? (
              <Box component="img" src={playlist.image} alt={playlist.title} sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <QueueMusicIcon color="disabled" sx={{ fontSize: 40 }} />
            )}
          </Box>
          <Box minWidth={0} flex={1}>
            <Typography variant="h6" noWrap sx={{ fontWeight: 700 }}>
              {playlist.title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {trackCount} {trackCount === 1 ? "track" : "tracks"} ·{" "}
              {playlist.publishedNaddr ? "Published" : "Local"}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <Button
                variant="contained"
                size="small"
                startIcon={<PlayArrowIcon />}
                onClick={() => playAll(false)}
                disabled={resolving || trackCount === 0}
                sx={{ textTransform: "none", borderRadius: 2 }}
              >
                Play all
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<ShuffleIcon />}
                onClick={() => playAll(true)}
                disabled={resolving || trackCount === 0}
                sx={{ textTransform: "none", borderRadius: 2 }}
              >
                Shuffle
              </Button>
            </Stack>
          </Box>
          <IconButton onClick={(e) => setMenuAnchor(e.currentTarget)} aria-label="Playlist options">
            <MoreVertIcon />
          </IconButton>
          <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
            <MenuItem
              onClick={() => {
                setMenuAnchor(null);
                setRenameValue(playlist.title);
              }}
            >
              <EditIcon fontSize="small" style={{ marginRight: 8 }} />
              Rename
            </MenuItem>
            <MenuItem onClick={startPublish} disabled={shareableCount === 0}>
              <PublicIcon fontSize="small" style={{ marginRight: 8 }} />
              Make public
            </MenuItem>
            <MenuItem
              onClick={async () => {
                setMenuAnchor(null);
                await deletePlaylist(playlist.id);
                navigate("/feeds/music");
              }}
            >
              Delete playlist
            </MenuItem>
          </Menu>
        </Stack>
      </Box>

      {trackCount === 0 ? (
        <Box display="flex" flexDirection="column" alignItems="center" gap={1} py={8}>
          <QueueMusicIcon color="disabled" sx={{ fontSize: 40 }} />
          <Typography variant="body2" color="text.secondary">
            This playlist is empty. Add tracks from the music feed or your local files.
          </Typography>
        </Box>
      ) : (
        <List dense disablePadding sx={{ px: 1, pb: 2 }}>
          {rows.map((r, i) => {
            const isCurrent = isRowCurrent(r);
            const duration = formatDuration(r.durationMs);
            return (
              <ListItemButton
                key={r.key}
                selected={isCurrent}
                disabled={!r.available}
                onClick={() => onRowClick(i)}
                sx={{ borderRadius: 1, gap: 1, opacity: r.available ? 1 : 0.5 }}
              >
                <Box sx={{ position: "relative", width: 44, height: 44, flexShrink: 0 }}>
                  {r.image ? (
                    <Box component="img" src={r.image} alt="" sx={{ width: 44, height: 44, borderRadius: 1, objectFit: "cover", display: "block" }} />
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
                    {r.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                    {r.available
                      ? r.artist || (r.ref.type === "local" ? "Local file" : "")
                      : r.ref.type === "local"
                      ? "Not on this device"
                      : "Unavailable"}
                  </Typography>
                </Box>
                {duration && (
                  <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                    {duration}
                  </Typography>
                )}
                <IconButton
                  size="small"
                  aria-label="Remove from playlist"
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeTrack(playlist.id, r.key);
                  }}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </ListItemButton>
            );
          })}
        </List>
      )}

      <Dialog
        open={renameValue !== null}
        onClose={() => setRenameValue(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Rename playlist</DialogTitle>
        <DialogContent>
          <TextField
            label="Title"
            value={renameValue ?? ""}
            onChange={(e) => setRenameValue(e.target.value)}
            autoFocus
            fullWidth
            size="small"
            sx={{ mt: 1 }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameValue?.trim()) {
                void renamePlaylist(playlist.id, renameValue.trim());
                setRenameValue(null);
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameValue(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!renameValue?.trim()}
            onClick={() => {
              if (renameValue?.trim()) {
                void renamePlaylist(playlist.id, renameValue.trim());
                setRenameValue(null);
              }
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmPublish} onClose={() => !publishing && setConfirmPublish(false)}>
        <DialogTitle>Make playlist public?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This publishes “{playlist.title}” to Nostr as a public playlist that
            anyone can see. Your local copy stays on this device.
            {localCount > 0 && (
              <>
                {" "}
                {localCount} local {localCount === 1 ? "song" : "songs"} can’t be
                shared and won’t be included.
              </>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmPublish(false)} disabled={publishing}>
            Cancel
          </Button>
          <Button variant="contained" onClick={doPublish} disabled={publishing}>
            {publishing ? "Publishing…" : "Make public"}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(snack)}
        autoHideDuration={5000}
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

export default PlaylistDetail;
