import { Event } from "nostr-tools";
import { PlaybackTrack } from "../../contexts/PlaybackContext";

// Music track events are kind 36787 — an addressable Wavlake/"gruuv" track that
// carries all its own metadata (title/artist/cover/audio) in tags.
export const KIND_MUSIC = 36787;

export const tagValue = (event: Event, name: string): string | undefined =>
  event.tags.find((t) => t[0] === name)?.[1];

export const tagValues = (event: Event, name: string): string[] =>
  event.tags.filter((t) => t[0] === name && t[1]).map((t) => t[1]);

// Stable identity for a track across the feed, inline embeds, and playlists: its
// addressable coordinate `36787:<pubkey>:<d>` (falling back to the event id).
export const trackCoord = (event: Event): string =>
  `${KIND_MUSIC}:${event.pubkey}:${tagValue(event, "d") || event.id}`;

// Convert a kind-36787 event into a PlaybackTrack, or null when it has no audio
// source. Sources are the primary `url` then any `fallback` mirrors, tried in
// order on load error. Shared by MusicCard and the playlist player so they never
// diverge on how a track is turned into something playable.
export const eventToPlaybackTrack = (
  event: Event,
  displayArtist?: string
): PlaybackTrack | null => {
  const sources = [tagValue(event, "url"), ...tagValues(event, "fallback")].filter(
    (u): u is string => !!u
  );
  if (!sources.length) return null;
  return {
    id: trackCoord(event),
    sources,
    title: tagValue(event, "title") || event.content || "Untitled track",
    artist:
      displayArtist ||
      tagValue(event, "artist") ||
      tagValue(event, "creator"),
    image: tagValue(event, "image") || tagValue(event, "cover"),
  };
};
