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
  /** Whether upcoming tracks play in a shuffled order. */
  shuffle: boolean;
  /** The active play order (what next/prev walk). */
  queue: PlaybackTrack[];
  /** Index of the current track within `queue`. */
  currentIndex: number;
  hasNext: boolean;
  hasPrev: boolean;
  /** Play a list of tracks as a queue (enables next/prev across them). */
  playQueue: (tracks: PlaybackTrack[], startIndex?: number) => void;
  /** Play a single track immediately (replaces the queue). */
  playTrack: (track: PlaybackTrack) => void;
  /** Append a track to the end of the queue (starts playback if idle). */
  addToQueue: (track: PlaybackTrack) => void;
  /** Insert a track right after the current one (starts playback if idle). */
  playNext: (track: PlaybackTrack) => void;
  /** Jump to a specific index in the queue. */
  playAt: (index: number) => void;
  toggle: () => void;
  toggleShuffle: () => void;
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
  shuffle: false,
  queue: [],
  currentIndex: -1,
  hasNext: false,
  hasPrev: false,
  playQueue: noop,
  playTrack: noop,
  addToQueue: noop,
  playNext: noop,
  playAt: noop,
  toggle: noop,
  toggleShuffle: noop,
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

// Fisher–Yates, non-mutating.
const shuffled = <T,>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const PlaybackProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Queue + cursor live in refs so the imperative controls below read current
  // values without being re-created on every position tick.
  const queueRef = useRef<PlaybackTrack[]>([]);
  // The order as last set by playQueue, used to restore order when shuffle is
  // turned back off. Manual queue edits append to it too.
  const originalRef = useRef<PlaybackTrack[]>([]);
  const indexRef = useRef<number>(-1);
  const srcIndexRef = useRef<number>(0);
  const shuffleRef = useRef<boolean>(false);

  const [current, setCurrent] = useState<PlaybackTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState<number>(initialVolume);
  const [shuffle, setShuffle] = useState(false);
  // Mirror of queueRef/indexRef for consumers (the MiniPlayer queue view).
  const [queue, setQueueState] = useState<PlaybackTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
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
          setCurrentIndex(s.index);
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

  // Push the active order down to the native service. Note: the plugin's setQueue
  // restarts from `startIndex`, so this is used for (re)starting a queue and for
  // shuffle toggles — an explicit user action where a brief restart is tolerable.
  const syncNative = useCallback(
    (order: PlaybackTrack[], startIndex: number) => {
      void (async () => {
        try {
          await MusicPlayback.ensureNotificationPermission();
        } catch {
          /* proceed regardless; playback still works, just without controls */
        }
        await MusicPlayback.setQueue({
          tracks: order.map((t) => ({
            id: t.id,
            sources: t.sources,
            title: t.title,
            artist: t.artist,
            image: t.image,
          })),
          startIndex,
        });
      })();
    },
    []
  );

  const load = useCallback((index: number) => {
    const audio = audioRef.current;
    const track = queueRef.current[index];
    if (!audio || !track || !track.sources.length) return;
    indexRef.current = index;
    srcIndexRef.current = 0;
    audio.src = track.sources[0];
    setCurrent(track);
    setCurrentIndex(index);
    setPosition(0);
    setDuration(0);
    audio.play().catch(() => setPlaying(false));
  }, []);

  // Commit a new order + cursor to refs and mirror state, then start the engine.
  const startOrder = useCallback(
    (order: PlaybackTrack[], index: number) => {
      queueRef.current = order;
      indexRef.current = index;
      setQueueState(order);
      setCurrentIndex(index);
      if (NATIVE) {
        setCurrent(order[index] ?? null);
        setPosition(0);
        setDuration(0);
        syncNative(order, index);
      } else {
        load(index);
      }
    },
    [load, syncNative]
  );

  const playQueue = useCallback(
    (tracks: PlaybackTrack[], startIndex = 0) => {
      if (!tracks.length) return;
      originalRef.current = tracks;
      // Honour the current shuffle mode: keep the chosen track first, shuffle the
      // rest, so starting a shuffled playlist plays the picked song then a random
      // walk of the others.
      if (shuffleRef.current) {
        const first = tracks[startIndex];
        const rest = shuffled(tracks.filter((_, i) => i !== startIndex));
        startOrder([first, ...rest], 0);
      } else {
        startOrder(tracks, startIndex);
      }
    },
    [startOrder]
  );

  const playTrack = useCallback(
    (track: PlaybackTrack) => {
      playQueue([track], 0);
    },
    [playQueue]
  );

  const addToQueue = useCallback(
    (track: PlaybackTrack) => {
      if (indexRef.current < 0 || !queueRef.current.length) {
        playQueue([track], 0);
        return;
      }
      queueRef.current = [...queueRef.current, track];
      originalRef.current = [...originalRef.current, track];
      setQueueState(queueRef.current);
      // Web walks queueRef directly, so the appended track is reachable. Native's
      // service owns its own queue and has no append command, so it won't see the
      // addition until the queue is next (re)started — a known native limitation.
    },
    [playQueue]
  );

  const playNext = useCallback(
    (track: PlaybackTrack) => {
      if (indexRef.current < 0 || !queueRef.current.length) {
        playQueue([track], 0);
        return;
      }
      const at = indexRef.current + 1;
      queueRef.current = [
        ...queueRef.current.slice(0, at),
        track,
        ...queueRef.current.slice(at),
      ];
      originalRef.current = [...originalRef.current, track];
      setQueueState(queueRef.current);
    },
    [playQueue]
  );

  const playAt = useCallback(
    (index: number) => {
      if (index < 0 || index >= queueRef.current.length) return;
      if (NATIVE) {
        // No "play at index" command on the plugin — re-send from this index.
        syncNative(queueRef.current, index);
        indexRef.current = index;
        setCurrentIndex(index);
        setCurrent(queueRef.current[index] ?? null);
        return;
      }
      load(index);
    },
    [load, syncNative]
  );

  const toggleShuffle = useCallback(() => {
    const nextShuffle = !shuffleRef.current;
    shuffleRef.current = nextShuffle;
    setShuffle(nextShuffle);

    const cur = queueRef.current[indexRef.current];
    if (!cur) return; // nothing playing — mode flag is enough for the next play

    let order: PlaybackTrack[];
    let index: number;
    if (nextShuffle) {
      // Keep the current track first; shuffle everything else.
      const rest = shuffled(
        queueRef.current.filter((_, i) => i !== indexRef.current)
      );
      order = [cur, ...rest];
      index = 0;
    } else {
      // Restore the original order, continuing from the current track's slot.
      order = originalRef.current.length ? originalRef.current : queueRef.current;
      const found = order.findIndex((t) => t.id === cur.id);
      index = found >= 0 ? found : 0;
    }
    queueRef.current = order;
    indexRef.current = index;
    setQueueState(order);
    setCurrentIndex(index);
    // The current track keeps playing on web (we don't reload it); only the
    // upcoming order changes. Native re-sends the queue (brief restart).
    if (NATIVE) syncNative(order, index);
  }, [syncNative]);

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
    try {
      localStorage.setItem(VOLUME_KEY, String(clamped));
    } catch {
      // localStorage may be full (QuotaExceededError) or unavailable; persisting
      // the volume is best-effort and must not break the slider / playback.
    }
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
    originalRef.current = [];
    indexRef.current = -1;
    setCurrent(null);
    setPlaying(false);
    setPosition(0);
    setDuration(0);
    setQueueState([]);
    setCurrentIndex(-1);
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
        shuffle,
        queue,
        currentIndex,
        hasNext,
        hasPrev,
        playQueue,
        playTrack,
        addToQueue,
        playNext,
        playAt,
        toggle,
        toggleShuffle,
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
