import { registerPlugin } from "@capacitor/core";

// A track from the device's MediaStore. `uri` is a content:// URI; convert it with
// Capacitor.convertFileSrc(uri) before handing it to an <audio> element.
export interface NativeTrack {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  uri: string;
}

export interface MusicLibraryPlugin {
  /** Whether audio-read permission is already granted (no prompt). */
  checkPermission(): Promise<{ granted: boolean }>;
  /** Prompt for audio-read permission. Must be called from a user gesture. */
  requestPermission(): Promise<{ granted: boolean }>;
  /** All music tracks on the device. Rejects with PERMISSION_DENIED if ungranted. */
  getTracks(): Promise<{ tracks: NativeTrack[] }>;
}

export const MusicLibrary = registerPlugin<MusicLibraryPlugin>("MusicLibrary");
