import React, { useState } from "react";
import {
  Box,
  IconButton,
  List,
  ListItemButton,
  Popover,
  Slider,
  Typography,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import SkipPreviousIcon from "@mui/icons-material/SkipPrevious";
import CloseIcon from "@mui/icons-material/Close";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import QueueMusicIcon from "@mui/icons-material/QueueMusic";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeDownIcon from "@mui/icons-material/VolumeDown";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import VolumeMuteIcon from "@mui/icons-material/VolumeMute";
import { usePlayback } from "../../contexts/PlaybackContext";

const formatTime = (s: number): string => {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

// A docked bar pinned to the bottom of the app's flex column. Because it's a
// flow sibling of the content area (not position:fixed), showing it shrinks the
// content instead of covering it. Renders nothing when nothing is playing.
const MiniPlayer: React.FC = () => {
  const {
    current,
    playing,
    position,
    duration,
    volume,
    shuffle,
    queue,
    currentIndex,
    hasNext,
    hasPrev,
    toggle,
    toggleShuffle,
    next,
    prev,
    playAt,
    seek,
    setVolume,
    stop,
  } = usePlayback();

  // The volume control lives in a popover off a single icon so it stays compact
  // on the packed bar. The icon doubles as a mute toggle, remembering the prior
  // level to restore on unmute.
  const [volAnchor, setVolAnchor] = useState<HTMLElement | null>(null);
  const [premuteVolume, setPremuteVolume] = useState(volume || 1);
  // The upcoming-tracks list opens in its own popover off the queue icon.
  const [queueAnchor, setQueueAnchor] = useState<HTMLElement | null>(null);

  const toggleMute = () => {
    if (volume > 0) {
      setPremuteVolume(volume);
      setVolume(0);
    } else {
      setVolume(premuteVolume || 1);
    }
  };

  const VolumeIcon =
    volume === 0
      ? VolumeOffIcon
      : volume < 0.33
      ? VolumeMuteIcon
      : volume < 0.66
      ? VolumeDownIcon
      : VolumeUpIcon;

  if (!current) return null;

  return (
    <Box
      sx={{
        flexShrink: 0,
        borderTop: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      <Box
        sx={{
          maxWidth: 800,
          mx: "auto",
          px: { xs: 1, sm: 2 },
          py: 0.75,
          display: "flex",
          alignItems: "center",
          gap: { xs: 0.5, sm: 1 },
        }}
      >
        {current.image ? (
          <Box
            component="img"
            src={current.image}
            alt={current.title}
            sx={{ width: 40, height: 40, borderRadius: 1, objectFit: "cover", flexShrink: 0 }}
          />
        ) : (
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 1,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "action.hover",
            }}
          >
            <MusicNoteIcon color="disabled" fontSize="small" />
          </Box>
        )}

        <Box sx={{ minWidth: 0, width: { xs: 120, sm: 180 } }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
            {current.title}
          </Typography>
          {current.artist && (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
              {current.artist}
            </Typography>
          )}
        </Box>

        <IconButton size="small" onClick={prev} disabled={!hasPrev} aria-label="Previous">
          <SkipPreviousIcon />
        </IconButton>
        <IconButton onClick={toggle} color="primary" aria-label={playing ? "Pause" : "Play"}>
          {playing ? <PauseIcon /> : <PlayArrowIcon />}
        </IconButton>
        <IconButton size="small" onClick={next} disabled={!hasNext} aria-label="Next">
          <SkipNextIcon />
        </IconButton>

        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ minWidth: 36, display: { xs: "none", sm: "block" } }}
        >
          {formatTime(position)}
        </Typography>
        <Slider
          size="small"
          value={position}
          min={0}
          max={duration || 0}
          onChange={(_, v) => seek(Array.isArray(v) ? v[0] : v)}
          disabled={!duration}
          aria-label="Seek"
          sx={{ mx: { xs: 0.5, sm: 1 } }}
        />
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ minWidth: 36, display: { xs: "none", sm: "block" } }}
        >
          {formatTime(duration)}
        </Typography>

        <IconButton
          size="small"
          onClick={toggleShuffle}
          aria-label="Shuffle"
          color={shuffle ? "primary" : "default"}
          sx={{ display: { xs: "none", sm: "inline-flex" } }}
        >
          <ShuffleIcon fontSize="small" />
        </IconButton>

        <IconButton
          size="small"
          onClick={(e) => setQueueAnchor(e.currentTarget)}
          aria-label="Queue"
          disabled={queue.length <= 1}
        >
          <QueueMusicIcon fontSize="small" />
        </IconButton>
        <Popover
          open={Boolean(queueAnchor)}
          anchorEl={queueAnchor}
          onClose={() => setQueueAnchor(null)}
          anchorOrigin={{ vertical: "top", horizontal: "center" }}
          transformOrigin={{ vertical: "bottom", horizontal: "center" }}
        >
          <Box sx={{ width: 280, maxHeight: 320, overflowY: "auto" }}>
            <Typography variant="overline" sx={{ px: 2, pt: 1, display: "block", color: "text.secondary" }}>
              Up next
            </Typography>
            <List dense disablePadding>
              {queue.map((t, i) => (
                <ListItemButton
                  key={`${t.id}-${i}`}
                  selected={i === currentIndex}
                  onClick={() => {
                    playAt(i);
                    setQueueAnchor(null);
                  }}
                  sx={{ gap: 1 }}
                >
                  <Box sx={{ width: 16, textAlign: "right", flexShrink: 0 }}>
                    {i === currentIndex ? (
                      <PlayArrowIcon sx={{ fontSize: 14 }} color="primary" />
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {i + 1}
                      </Typography>
                    )}
                  </Box>
                  <Box minWidth={0} flex={1}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: i === currentIndex ? 600 : 400 }}>
                      {t.title}
                    </Typography>
                    {t.artist && (
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                        {t.artist}
                      </Typography>
                    )}
                  </Box>
                </ListItemButton>
              ))}
            </List>
          </Box>
        </Popover>

        <IconButton
          size="small"
          onClick={(e) => setVolAnchor(e.currentTarget)}
          aria-label="Volume"
        >
          <VolumeIcon fontSize="small" />
        </IconButton>
        <Popover
          open={Boolean(volAnchor)}
          anchorEl={volAnchor}
          onClose={() => setVolAnchor(null)}
          anchorOrigin={{ vertical: "top", horizontal: "center" }}
          transformOrigin={{ vertical: "bottom", horizontal: "center" }}
        >
          <Box
            sx={{
              px: 1,
              pt: 2,
              pb: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 1,
              height: 140,
            }}
          >
            <Slider
              size="small"
              orientation="vertical"
              value={volume}
              min={0}
              max={1}
              step={0.01}
              onChange={(_, v) => setVolume(Array.isArray(v) ? v[0] : v)}
              aria-label="Volume"
            />
            <IconButton size="small" onClick={toggleMute} aria-label={volume === 0 ? "Unmute" : "Mute"}>
              <VolumeIcon fontSize="small" />
            </IconButton>
          </Box>
        </Popover>

        <IconButton size="small" onClick={stop} aria-label="Close player">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
};

export default MiniPlayer;
