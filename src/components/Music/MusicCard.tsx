import React, { useEffect } from "react";
import {
  Box,
  Card,
  CardMedia,
  Typography,
  IconButton,
  Slider,
  Chip,
  Stack,
  Tooltip,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import DownloadIcon from "@mui/icons-material/Download";
import { Event, nip19 } from "nostr-tools";
import { useAppContext } from "../../hooks/useAppContext";
import { useNotification } from "../../contexts/notification-context";
import { usePlayback } from "../../contexts/PlaybackContext";
import {
  KIND_MUSIC,
  tagValue,
  tagValues,
  trackCoord,
} from "./musicTrack";
import AddToPlaylistButton from "./AddToPlaylistButton";
import { downloadTrack } from "./downloadTrack";

// Re-exported for the many call sites that import the music kind from here.
export { KIND_MUSIC };

const formatTime = (s: number): string => {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

interface MusicCardProps {
  event: Event;
  // When provided, starting playback defers to the parent so it can enqueue the
  // whole feed (next/prev walk it). Falls back to playing this track alone.
  onPlay?: () => void;
}

export const MusicCard: React.FC<MusicCardProps> = ({ event, onPlay }) => {
  const { fetchUserProfileThrottled, profiles } = useAppContext();
  const { showNotification } = useNotification();
  const {
    current,
    playing,
    position,
    duration,
    playTrack,
    toggle,
    seek,
  } = usePlayback();

  const title = tagValue(event, "title") || event.content || "Untitled track";
  const artist = tagValue(event, "artist") || tagValue(event, "creator");
  const album = tagValue(event, "album");
  const image = tagValue(event, "image") || tagValue(event, "cover");
  const genre = tagValue(event, "genre");
  const durationTag = Number(tagValue(event, "duration")) || 0;

  // Primary `url` first, then `fallback` mirrors (Blossom servers keyed by hash);
  // the player advances through them on load error.
  const sources = [tagValue(event, "url"), ...tagValues(event, "fallback")].filter(
    (u): u is string => !!u
  );
  const playable = sources.length > 0;

  // Stable identity across the feed and inline embeds — the addressable coordinate.
  const trackId = trackCoord(event);
  const isCurrent = current?.id === trackId;
  const isPlaying = isCurrent && playing;

  // Resolve the publisher's profile lazily so we can credit who shared the track.
  const publisher = profiles?.get(event.pubkey);
  useEffect(() => {
    if (!publisher) fetchUserProfileThrottled(event.pubkey);
  }, [publisher, event.pubkey, fetchUserProfileThrottled]);

  const displayArtist =
    artist || publisher?.name || nip19.npubEncode(event.pubkey).slice(0, 12) + "…";

  const handleToggle = () => {
    if (!playable) return;
    if (isCurrent) toggle();
    else if (onPlay) onPlay();
    else playTrack({ id: trackId, sources, title, artist: displayArtist, image });
  };

  const [downloading, setDownloading] = React.useState(false);
  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    showNotification("Downloading…", "info", 2000);
    try {
      const result = await downloadTrack(sources[0], title, displayArtist);
      if (result.status === "saved") {
        showNotification(
          result.location ? `Saved to ${result.location}` : "Download started",
          "success"
        );
      } else {
        showNotification("Opened in your browser", "info");
      }
    } catch {
      showNotification("Couldn't download this track", "error");
    } finally {
      setDownloading(false);
    }
  };

  // The scrubber is live only while this is the active track; otherwise it shows
  // the track's tagged length as a static hint.
  const sliderValue = isCurrent ? position : 0;
  const sliderMax = (isCurrent ? duration : 0) || durationTag;

  return (
    <Card sx={{ display: "flex", alignItems: "stretch", mb: 2 }}>
      <Box
        sx={{
          position: "relative",
          width: 96,
          minWidth: 96,
          cursor: playable ? "pointer" : "default",
        }}
        onClick={handleToggle}
      >
        {image ? (
          <CardMedia component="img" sx={{ width: 96, height: 96 }} image={image} alt={title} />
        ) : (
          <Box
            sx={{
              width: 96,
              height: 96,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "action.hover",
            }}
          >
            <MusicNoteIcon color="disabled" />
          </Box>
        )}
        {playable && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "rgba(0,0,0,0.25)",
              opacity: isPlaying ? 0 : 1,
              transition: "opacity 0.2s",
              "&:hover": { opacity: 1 },
            }}
          >
            {isPlaying ? (
              <PauseIcon sx={{ color: "white", fontSize: 40 }} />
            ) : (
              <PlayArrowIcon sx={{ color: "white", fontSize: 40 }} />
            )}
          </Box>
        )}
      </Box>

      <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, p: 1.5 }}>
        <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" noWrap>
          {displayArtist}
          {album ? ` · ${album}` : ""}
        </Typography>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: "auto" }}>
          <IconButton
            onClick={handleToggle}
            disabled={!playable}
            size="small"
            color="primary"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
          </IconButton>
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 36 }}>
            {formatTime(sliderValue)}
          </Typography>
          <Slider
            size="small"
            value={sliderValue}
            min={0}
            max={sliderMax || 0}
            onChange={(_, v) => isCurrent && seek(Array.isArray(v) ? v[0] : v)}
            disabled={!isCurrent || !sliderMax}
            sx={{ mx: 0.5 }}
            aria-label="Seek"
          />
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 36 }}>
            {formatTime(sliderMax)}
          </Typography>
          <AddToPlaylistButton
            track={{ type: "nostr", coord: trackId }}
            sourceEventId={event.id}
          />
          {playable && (
            <Tooltip title="Download">
              <span>
                <IconButton
                  size="small"
                  aria-label="Download track"
                  disabled={downloading}
                  onClick={handleDownload}
                >
                  <DownloadIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>

        {genre && (
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
            <Chip label={genre} size="small" variant="outlined" sx={{ fontSize: "0.65rem" }} />
          </Stack>
        )}
      </Box>
    </Card>
  );
};

export default MusicCard;
