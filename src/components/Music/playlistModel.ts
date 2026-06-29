import { nip19 } from "nostr-tools";

// Playlists are LOCAL by default — stored on the device (IndexedDB), never on a
// relay — so they can freely mix local files and Nostr tracks and work logged-out.
// A local playlist can optionally be *published* as a standard public Nostr
// playlist (kind 34139, the Wavlake/Fountain convention), at which point its local
// tracks are dropped (they can't be shared) and only the Nostr `a` coordinates go
// public. We never invented an encrypted-playlist kind: if you want it private,
// keep it local; if you want to share it, it's the public standard.
export const KIND_PUBLIC_PLAYLIST = 34139;

export const newPlaylistId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// A Nostr track, referenced by its addressable coordinate (+ optional relay hint).
export interface NostrTrackRef {
  type: "nostr";
  coord: string; // 36787:<pubkey>:<d>
  relay?: string;
}

// A local device file, referenced by enough metadata to render the row even when
// the file isn't present (e.g. on another device). Identity comes from one of:
//   • `fingerprint` — web tracks: the SHA-256 of the file bytes, matched back to a
//     handle/blob in the IndexedDB store (browser File handles aren't serializable,
//     so we can't store a path).
//   • `uri` — Android tracks: the MediaStore `content://` URI, which is both stable
//     per-file and directly playable, so native tracks need no separate store.
// Exactly one is set per ref.
export interface LocalTrackRef {
  type: "local";
  fingerprint?: string;
  uri?: string;
  title: string;
  artist?: string;
  durationMs?: number;
  filename?: string;
}

export type PlaylistTrackRef = NostrTrackRef | LocalTrackRef;

export const isLocalRef = (r: PlaylistTrackRef): r is LocalTrackRef =>
  r.type === "local";

// Stable key for a track ref — dedupe within a playlist and React keys.
export const trackRefKey = (ref: PlaylistTrackRef): string =>
  ref.type === "nostr"
    ? `a:${ref.coord}`
    : ref.uri
    ? `local:uri:${ref.uri}`
    : `local:${ref.fingerprint}`;

// The `<d>` portion of a track coordinate (`36787:<pubkey>:<d>`); `d` may itself
// contain colons, so keep everything after the second one.
export const coordDTag = (coord: string): string =>
  coord.split(":").slice(2).join(":");

// Parse an `a` tag (`["a", coord, relay?]`) from a public playlist into a Nostr
// track ref, preserving the optional relay hint that tells us where the track lives.
export const aTagToTrackRef = (tag: string[]): NostrTrackRef => ({
  type: "nostr",
  coord: tag[1],
  relay: tag[2] || undefined,
});

// naddr for a published (kind 34139) playlist's addressable coordinate.
export const publicPlaylistNaddr = (pubkey: string, identifier: string): string =>
  nip19.naddrEncode({ kind: KIND_PUBLIC_PLAYLIST, pubkey, identifier });
