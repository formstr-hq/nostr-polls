import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

// A single unified track shape for everything the player can play: Nostr tracks
// (kind 36787) and local device files alike. `sources` is the primary URL plus
// any fallback mirrors, tried in order if one fails to load.
export interface PlaybackTrack {
  id: string;
  sources: string[];
  title: string;
  artist?: string;
  image?: string;
}

interface PlaybackCtx {
  current: PlaybackTrack | null;
  playing: boolean;
  position: number;
  duration: number;
  hasNext: boolean;
  hasPrev: boolean;
  /** Play a list of tracks as a queue (enables next/prev across them). */
  playQueue: (tracks: PlaybackTrack[], startIndex?: number) => void;
  /** Play a single track immediately (replaces the queue). */
  playTrack: (track: PlaybackTrack) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (t: number) => void;
  stop: () => void;
}

const noop = () => {};
const PlaybackContext = createContext<PlaybackCtx>({
  current: null,
  playing: false,
  position: 0,
  duration: 0,
  hasNext: false,
  hasPrev: false,
  playQueue: noop,
  playTrack: noop,
  toggle: noop,
  next: noop,
  prev: noop,
  seek: noop,
  stop: noop,
});

export const PlaybackProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Queue + cursor live in refs so the imperative controls below read current
  // values without being re-created on every position tick.
  const queueRef = useRef<PlaybackTrack[]>([]);
  const indexRef = useRef<number>(-1);
  const srcIndexRef = useRef<number>(0);

  const [current, setCurrent] = useState<PlaybackTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  const load = useCallback((index: number) => {
    const audio = audioRef.current;
    const track = queueRef.current[index];
    if (!audio || !track || !track.sources.length) return;
    indexRef.current = index;
    srcIndexRef.current = 0;
    audio.src = track.sources[0];
    setCurrent(track);
    setPosition(0);
    setDuration(0);
    audio.play().catch(() => setPlaying(false));
  }, []);

  const playQueue = useCallback((tracks: PlaybackTrack[], startIndex = 0) => {
    if (!tracks.length) return;
    queueRef.current = tracks;
    load(startIndex);
  }, [load]);

  const playTrack = useCallback((track: PlaybackTrack) => {
    queueRef.current = [track];
    load(0);
  }, [load]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.paused) audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }, [current]);

  const next = useCallback(() => {
    if (indexRef.current + 1 < queueRef.current.length) load(indexRef.current + 1);
  }, [load]);

  const prev = useCallback(() => {
    if (indexRef.current - 1 >= 0) load(indexRef.current - 1);
  }, [load]);

  const seek = useCallback((t: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = t;
    setPosition(t);
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    queueRef.current = [];
    indexRef.current = -1;
    setCurrent(null);
    setPlaying(false);
    setPosition(0);
    setDuration(0);
  }, []);

  // On a load error, fall through to the next mirror; give up only when every
  // source for the current track has failed.
  const handleError = useCallback(() => {
    const audio = audioRef.current;
    const track = queueRef.current[indexRef.current];
    if (audio && track && srcIndexRef.current + 1 < track.sources.length) {
      srcIndexRef.current += 1;
      audio.src = track.sources[srcIndexRef.current];
      audio.play().catch(() => setPlaying(false));
    } else {
      setPlaying(false);
    }
  }, []);

  const hasNext = indexRef.current + 1 < queueRef.current.length;
  const hasPrev = indexRef.current > 0;

  return (
    <PlaybackContext.Provider
      value={{
        current,
        playing,
        position,
        duration,
        hasNext,
        hasPrev,
        playQueue,
        playTrack,
        toggle,
        next,
        prev,
        seek,
        stop,
      }}
    >
      {children}
      {/* One audio element for the whole app. Rendered above the Router so it
          keeps playing as the user navigates between feeds. */}
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => next()}
        onTimeUpdate={(e) => setPosition((e.target as HTMLAudioElement).currentTime)}
        onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration)}
        onError={handleError}
      />
    </PlaybackContext.Provider>
  );
};

export function usePlayback() {
  return useContext(PlaybackContext);
}
