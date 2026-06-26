import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Card,
  CardMedia,
  Typography,
  IconButton,
  Slider,
  Chip,
  Stack,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import { Event, nip19 } from "nostr-tools";
import { useAppContext } from "../../hooks/useAppContext";

// Music track events are kind 36787 — an addressable Wavlake/"gruuv" track. The
// event itself carries all the metadata we render (title/artist/cover/audio),
// so unlike MovieCard there's no community-metadata aggregation here.
export const KIND_MUSIC = 36787;

const tagValue = (event: Event, name: string): string | undefined =>
  event.tags.find((t) => t[0] === name)?.[1];

const tagValues = (event: Event, name: string): string[] =>
  event.tags.filter((t) => t[0] === name && t[1]).map((t) => t[1]);

const formatTime = (s: number): string => {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

// Only one track plays at a time across the feed: starting one pauses whichever
// was playing. Module-level so every MusicCard shares the same "now playing".
let activeAudio: HTMLAudioElement | null = null;

interface MusicCardProps {
  event: Event;
}

export const MusicCard: React.FC<MusicCardProps> = ({ event }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  // Primary `url` first, then `fallback` mirrors (Blossom servers keyed by hash).
  // On a load error we advance to the next source rather than failing outright.
  const [srcIndex, setSrcIndex] = useState(0);

  const { fetchUserProfileThrottled, profiles } = useAppContext();

  const title = tagValue(event, "title") || event.content || "Untitled track";
  const artist = tagValue(event, "artist") || tagValue(event, "creator");
  const album = tagValue(event, "album");
  const image = tagValue(event, "image") || tagValue(event, "cover");
  const genre = tagValue(event, "genre");
  const durationTag = Number(tagValue(event, "duration")) || 0;

  const sources = [tagValue(event, "url"), ...tagValues(event, "fallback")].filter(
    (u): u is string => !!u
  );
  const src = sources[srcIndex];
  const playable = !!src;

  // Resolve the publisher's profile lazily so we can credit who shared the track.
  const publisher = profiles?.get(event.pubkey);
  useEffect(() => {
    if (!publisher) fetchUserProfileThrottled(event.pubkey);
  }, [publisher, event.pubkey, fetchUserProfileThrottled]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !playable) return;
    if (audio.paused) {
      if (activeAudio && activeAudio !== audio) activeAudio.pause();
      activeAudio = audio;
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, [playable]);

  const handleSeek = useCallback((_: unknown, value: number | number[]) => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = Array.isArray(value) ? value[0] : value;
    audio.currentTime = next;
    setCurrent(next);
  }, []);

  // If a source fails to load, fall through to the next mirror; give up only
  // when every source has been tried.
  const handleError = useCallback(() => {
    setSrcIndex((i) => (i + 1 < sources.length ? i + 1 : i));
  }, [sources.length]);

  const total = duration || durationTag;
  const displayArtist =
    artist || publisher?.name || nip19.npubEncode(event.pubkey).slice(0, 12) + "…";

  return (
    <Card sx={{ display: "flex", alignItems: "stretch", mb: 2 }}>
      <Box
        sx={{
          position: "relative",
          width: 96,
          minWidth: 96,
          cursor: playable ? "pointer" : "default",
        }}
        onClick={togglePlay}
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
              opacity: playing ? 0 : 1,
              transition: "opacity 0.2s",
              "&:hover": { opacity: 1 },
            }}
          >
            {playing ? (
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
            onClick={togglePlay}
            disabled={!playable}
            size="small"
            color="primary"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <PauseIcon /> : <PlayArrowIcon />}
          </IconButton>
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 36 }}>
            {formatTime(current)}
          </Typography>
          <Slider
            size="small"
            value={current}
            min={0}
            max={total || 0}
            onChange={handleSeek}
            disabled={!playable || !total}
            sx={{ mx: 0.5 }}
            aria-label="Seek"
          />
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 36 }}>
            {formatTime(total)}
          </Typography>
        </Box>

        {genre && (
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
            <Chip label={genre} size="small" variant="outlined" sx={{ fontSize: "0.65rem" }} />
          </Stack>
        )}
      </Box>

      {playable && (
        <audio
          ref={audioRef}
          src={src}
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setCurrent(0);
          }}
          onTimeUpdate={(e) => setCurrent((e.target as HTMLAudioElement).currentTime)}
          onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration)}
          onError={handleError}
        />
      )}
    </Card>
  );
};

export default MusicCard;
