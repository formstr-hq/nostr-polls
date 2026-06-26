import { registerPlugin, PluginListenerHandle } from "@capacitor/core";

// A track handed to the native ExoPlayer queue. `sources` is the primary URL plus
// any fallback mirrors, tried in order if one fails to load (mirrors the web
// player's behaviour, but native-side so it survives backgrounding).
export interface NativeQueueTrack {
  id: string;
  sources: string[];
  title: string;
  artist?: string;
  image?: string;
}

// Player state pushed up from native. Positions/durations are in seconds, to
// match the web `<audio>` contract the PlaybackContext exposes.
export interface NativeSync {
  playing: boolean;
  index: number;
  hasNext: boolean;
  hasPrev: boolean;
  duration: number;
}

export interface NativePosition {
  position: number;
  duration: number;
}

export interface MusicPlaybackPlugin {
  /**
   * Ensure POST_NOTIFICATIONS is granted (Android 13+). Required before playback:
   * without it the media notification can't post and the foreground service is
   * killed by the OS. No-op (resolves granted) on older Android.
   */
  ensureNotificationPermission(): Promise<{ granted: boolean }>;
  /** Replace the queue and start playing at startIndex. Boots the service. */
  setQueue(opts: { tracks: NativeQueueTrack[]; startIndex: number }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  skipNext(): Promise<void>;
  skipPrev(): Promise<void>;
  /** Seek within the current track. position is in seconds. */
  seekTo(opts: { position: number }): Promise<void>;
  /** 0.0–1.0. */
  setVolume(opts: { volume: number }): Promise<void>;
  /** Stop playback and tear down the service + notification. */
  stop(): Promise<void>;
  addListener(
    eventName: "sync",
    cb: (state: NativeSync) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "position",
    cb: (state: NativePosition) => void
  ): Promise<PluginListenerHandle>;
}

export const MusicPlayback = registerPlugin<MusicPlaybackPlugin>("MusicPlayback");
