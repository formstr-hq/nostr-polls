import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Capacitor } from "@capacitor/core";
import { MusicPlayback } from "../plugins/musicPlayback";

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
  /** 0.0–1.0. */
  volume: number;
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
  setVolume: (v: number) => void;
  stop: () => void;
}

const noop = () => {};
const PlaybackContext = createContext<PlaybackCtx>({
  current: null,
  playing: false,
  position: 0,
  duration: 0,
  volume: 1,
  hasNext: false,
  hasPrev: false,
  playQueue: noop,
  playTrack: noop,
  toggle: noop,
  next: noop,
  prev: noop,
  seek: noop,
  setVolume: noop,
  stop: noop,
});

// On native, ExoPlayer in a foreground service does the actual playback (so it
// keeps going when the app is backgrounded / closed) and owns the queue; this
// context becomes a thin controller that mirrors native state. On web, the
// <audio> element below is the engine.
const NATIVE = Capacitor.isNativePlatform();

const VOLUME_KEY = "pollerama:musicVolume";
const initialVolume = (): number => {
  const stored = Number(localStorage.getItem(VOLUME_KEY));
  return isFinite(stored) && stored >= 0 && stored <= 1 ? stored : 1;
};

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
  const [volume, setVolumeState] = useState<number>(initialVolume);
  // Native next/prev availability (web derives these from the queue refs).
  const [nav, setNav] = useState({ hasNext: false, hasPrev: false });

  // ── Native: mirror ExoPlayer state pushed up from the service ──────────────
  useEffect(() => {
    if (!NATIVE) return;
    const handles = [
      MusicPlayback.addListener("sync", (s) => {
        setPlaying(s.playing);
        setDuration(s.duration);
        setNav({ hasNext: s.hasNext, hasPrev: s.hasPrev });
        const track = queueRef.current[s.index];
        if (track) {
          indexRef.current = s.index;
          setCurrent(track);
        }
      }),
      MusicPlayback.addListener("position", (s) => {
        setPosition(s.position);
        if (s.duration) setDuration(s.duration);
      }),
    ];
    return () => {
      handles.forEach((h) => h.then((l) => l.remove()));
    };
  }, []);

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

  const playQueue = useCallback(
    (tracks: PlaybackTrack[], startIndex = 0) => {
      if (!tracks.length) return;
      queueRef.current = tracks;
      if (NATIVE) {
        indexRef.current = startIndex;
        setCurrent(tracks[startIndex] ?? null);
        setPosition(0);
        setDuration(0);
        // Secure the notification permission first: Media3 promotes the service
        // to foreground via its media notification, so without the grant the OS
        // kills the service shortly after it starts.
        void (async () => {
          try {
            await MusicPlayback.ensureNotificationPermission();
          } catch {
            /* proceed regardless; playback still works, just without controls */
          }
          await MusicPlayback.setQueue({
            tracks: tracks.map((t) => ({
              id: t.id,
              sources: t.sources,
              title: t.title,
              artist: t.artist,
              image: t.image,
            })),
            startIndex,
          });
        })();
        return;
      }
      load(startIndex);
    },
    [load]
  );

  const playTrack = useCallback(
    (track: PlaybackTrack) => {
      playQueue([track], 0);
    },
    [playQueue]
  );

  const toggle = useCallback(() => {
    if (NATIVE) {
      if (!current) return;
      if (playing) void MusicPlayback.pause();
      else void MusicPlayback.play();
      return;
    }
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.paused) audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }, [current, playing]);

  const next = useCallback(() => {
    if (NATIVE) {
      void MusicPlayback.skipNext();
      return;
    }
    if (indexRef.current + 1 < queueRef.current.length) load(indexRef.current + 1);
  }, [load]);

  const prev = useCallback(() => {
    if (NATIVE) {
      void MusicPlayback.skipPrev();
      return;
    }
    if (indexRef.current - 1 >= 0) load(indexRef.current - 1);
  }, [load]);

  const seek = useCallback((t: number) => {
    if (NATIVE) {
      setPosition(t);
      void MusicPlayback.seekTo({ position: t });
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = t;
    setPosition(t);
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    localStorage.setItem(VOLUME_KEY, String(clamped));
    if (NATIVE) {
      void MusicPlayback.setVolume({ volume: clamped });
      return;
    }
    if (audioRef.current) audioRef.current.volume = clamped;
  }, []);

  const stop = useCallback(() => {
    if (NATIVE) {
      void MusicPlayback.stop();
    } else {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    }
    queueRef.current = [];
    indexRef.current = -1;
    setCurrent(null);
    setPlaying(false);
    setPosition(0);
    setDuration(0);
    setNav({ hasNext: false, hasPrev: false });
  }, []);

  // On a load error, fall through to the next mirror; give up only when every
  // source for the current track has failed. (Web only — native does this in
  // the service.)
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

  const hasNext = NATIVE
    ? nav.hasNext
    : indexRef.current + 1 < queueRef.current.length;
  const hasPrev = NATIVE ? nav.hasPrev : indexRef.current > 0;

  return (
    <PlaybackContext.Provider
      value={{
        current,
        playing,
        position,
        duration,
        volume,
        hasNext,
        hasPrev,
        playQueue,
        playTrack,
        toggle,
        next,
        prev,
        seek,
        setVolume,
        stop,
      }}
    >
      {children}
      {/* One audio element for the whole app, used on web. Rendered above the
          Router so it keeps playing as the user navigates between feeds. On
          native this stays idle — ExoPlayer in the service is the engine. */}
      {!NATIVE && (
        <audio
          ref={audioRef}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => next()}
          onTimeUpdate={(e) =>
            setPosition((e.target as HTMLAudioElement).currentTime)
          }
          onLoadedMetadata={(e) => {
            const el = e.target as HTMLAudioElement;
            el.volume = volume;
            setDuration(el.duration);
          }}
          onError={handleError}
        />
      )}
    </PlaybackContext.Provider>
  );
};

export function usePlayback() {
  return useContext(PlaybackContext);
}
