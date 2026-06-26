import React from "react";
import { Box, IconButton, Slider, Typography } from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import SkipPreviousIcon from "@mui/icons-material/SkipPrevious";
import CloseIcon from "@mui/icons-material/Close";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
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
    hasNext,
    hasPrev,
    toggle,
    next,
    prev,
    seek,
    stop,
  } = usePlayback();

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

        <IconButton size="small" onClick={stop} aria-label="Close player">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
};

export default MiniPlayer;
