# Music feature — plan & status

A dedicated music experience: a music feed, a global persistent player, local-file
playback, encrypted playlists spanning local + Nostr tracks, and track publishing.
Built in **3 phases**. Phase 1 is done; 2 and 3 are planned below.

## Nostr kinds
- **Track = kind 36787** — addressable Wavlake/"gruuv" track. Carries its own
  metadata tags: `title`, `artist`/`creator`, `album`, `image`/`cover`, `genre`,
  `duration`, `url` (primary audio) + `fallback` mirrors, `d` (identifier).
- **Playlist = kind 34139** — addressable (`d` tag), references tracks via `a` tags
  (`36787:<pubkey>:<d>`) plus `title`/`image`/`description`. Wavlake/Fountain
  "Nostr Music" convention. (No suitable open *encrypted* playlist spec exists, so
  Phase 2 defines our own — see below.)

## Locked design decisions
- **Music feed** at `/feeds/music`. Sub-nav: **Discover** (global tracks) /
  **Following** (tracks from follows) / **Local** (device files). Top of the page
  (Phase 2): a horizontally scrollable strip of playlist cards + "New playlist".
- **Global persistent player** — music keeps playing while navigating other feeds.
  Mirrors the existing `VideoPlayerContext` + root-mounted `FloatingVideoPlayer`
  pattern: a `PlaybackContext` owns ONE `<audio>` element (mounted above the Router
  so it survives route changes) and a **docked** `MiniPlayer` bar mounted as the
  last child of the app's flex column — so showing it *shrinks the content above*
  instead of overlaying it (never hides feed items). Not floating.
- **Local-music persistence (web)** — tiered, to avoid copying bytes where possible:
  - Chromium (File System Access API): store the `FileSystemFileHandle` — a
    reference, no copy — re-read via `getFile()` after a permission confirm on play.
  - Firefox/Safari (no FSA): store the `File` blob in IndexedDB (a copy; accepted
    tradeoff — no handle primitive exists there).
  - localStorage can't do either (binary data + object-URL lifetime).
- **Local-music on native (Android)** — auto-scan the device library via MediaStore
  (a custom Java Capacitor plugin), not the web file picker. Web `<input>`/FSA paths
  stay for the browser.
- **Playlists are our own encrypted spec** (Phase 2): kind 34139, with the track
  list stored **encrypted-to-self** in `content` via `signer.nip44Encrypt`/`Decrypt`
  (exactly as `src/contexts/lists-context.tsx` does for NIP-51 private lists). The
  unified track list holds BOTH Nostr tracks (`a` coords) and local-file entries
  (title/artist/duration + content-hash; playable only on the owning device, shown
  as unavailable elsewhere). New playlists default to **encrypted**, with a public
  toggle.
- **Note creator "Music" tab** (Phase 3) — publish a NEW track (kind 36787): audio
  upload to Blossom + cover + metadata. `EventCreator/EventForm.tsx` is MUI `Tabs`;
  add a 3rd tab next to Note/Poll.

---

## Phase 1 — feed + global player + local files — DONE (web verified)

Web side built and user-verified. Android MediaStore plugin written but **untested**
(to be built/tested on a device).

**Web/shared files**
- `src/components/Feed/MusicFeed.tsx` — feed modeled on `ArticlesFeed`; sources
  Discover/Following query kind 36787 (cursor + dedup + infinite scroll via
  `UnifiedFeed`); Local renders `LocalMusic`.
- `src/components/Music/MusicCard.tsx` — dispatches play to the global player; its
  scrubber is live only when it's the active track. `KIND_MUSIC = 36787` exported.
- `src/components/Music/MiniPlayer.tsx` — docked bottom bar (play/pause, prev/next,
  seek, close).
- `src/components/Music/LocalMusic.tsx` — local tab; native scan + web FSA/`<input>`.
- `src/components/Music/localMusicStore.ts` — IndexedDB store (handle OR blob).
- `src/contexts/PlaybackContext.tsx` — global player; unified `PlaybackTrack`
  (`{ id, sources[], title, artist?, image? }`), queue with next/prev, fallback-mirror
  handling on load error.
- `src/plugins/musicLibrary.ts` — typed JS bridge to the native plugin.
- Wiring: `src/App.tsx` (route `feeds/music`, `PlaybackProvider` around Router,
  `<MiniPlayer/>` at column bottom); `src/components/SidePane/index.tsx` (Music nav
  entry + mobile sub-tabs + storage key `pollerama:musicSource` + default sub).

**Android (written, untested)**
- `android/app/src/main/java/com/formstr/pollerama/MusicLibraryPlugin.java` — queries
  `MediaStore.Audio` (`IS_MUSIC`), returns id/title/artist/album/durationMs/`content://`
  uri; `checkPermission`/`requestPermission`/`getTracks`.
- Registered in `MainActivity.java` (`registerPlugin(MusicLibraryPlugin.class)` before
  `super.onCreate`).
- `AndroidManifest.xml` — `READ_MEDIA_AUDIO` (13+) + `READ_EXTERNAL_STORAGE`
  (`maxSdkVersion=32`). The plugin's `@Permission` alias lists both strings; the
  granted-check uses the OS-correct one.

### Background playback (native) — written, untested
Music keeps playing when the app is backgrounded or swiped from recents, with
lock-screen / notification controls and headset-button handling.
- `PlaybackService.java` — a Media3 `MediaSessionService` hosting `ExoPlayer` +
  `MediaSession`. Owns the queue natively (auto-advance, next/prev), does the
  per-item fallback-mirror retry on player error, ticks position 1×/s, and
  forwards state to the plugin. `onTaskRemoved` keeps the service alive while
  playing and stops it when paused.
- `MusicPlaybackPlugin.java` (Capacitor plugin `MusicPlayback`) — relays
  setQueue/play/pause/skipNext/skipPrev/seekTo/setVolume/stop to the service and
  emits `sync` / `position` events to JS. Stages the queue + boots the service
  when first asked (`startForegroundService` → `flushPending`).
- Registered in `MainActivity.java`; deps in `app/build.gradle`
  (`media3-exoplayer` + `media3-session` 1.4.1); manifest gets the service
  declaration + `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_MEDIA_PLAYBACK`.
- JS: `src/plugins/musicPlayback.ts` bridge; `PlaybackContext.tsx` branches on
  `Capacitor.isNativePlatform()` — native routes commands to the plugin and
  mirrors state from its events; web keeps the `<audio>` engine. Positions are
  in seconds on both sides.

### Volume control (web + native)
`PlaybackContext` exposes `volume` + `setVolume` (persisted to
`localStorage["pollerama:musicVolume"]`; `audio.volume` on web,
`player.setVolume` native). `MiniPlayer` has a volume icon → popover with a
vertical slider + mute toggle.

**To build/test native**
```
npx cap sync android
npx cap run android        # or build the APK in Android Studio
```
Background-playback checks, in priority order:
1. Play a track, press Home / lock the screen → audio continues; a media
   notification with cover art + play/pause/skip appears (and lock-screen
   controls).
2. Swipe the app from recents **while playing** → keeps playing; **while paused**
   → service + notification go away.
3. Headset/Bluetooth play-pause buttons and "becoming noisy" (unplug → pause).
4. Volume slider in the MiniPlayer changes ExoPlayer output.
Verify on device, in priority order:
1. **`content://` playback via `Capacitor.convertFileSrc`** — riskiest unknown. If
   tracks list but won't play, the local server isn't resolving content URIs; add a
   plugin fallback (stream bytes / copy to a cache file the WebView can read).
2. Permission prompt on first "Scan device music"; the already-granted auto-scan path.
3. Android ≤12 device (storage-permission path).

---

## Phase 2 — playlists (planned)
- Horizontal playlist-cards strip on `/feeds/music` (🔒 badge for encrypted) +
  "New playlist" card.
- Encrypted create/edit (kind 34139, nip44-to-self) reusing the `lists-context.tsx`
  pattern; unified entries for Nostr (`a` coords) + local (metadata + content-hash).
- Playlist detail at `/feeds/music/:naddr` with queue playback + auto-advance.
- Make the Discover feed play as a queue so MiniPlayer next/prev walk the list
  (today `MusicCard` plays a single track).

## Phase 3 — publish a track (planned)
- 3rd "Music" tab in `EventForm.tsx` → `MusicTemplateForm`: audio upload (Blossom) +
  cover + metadata → sign & publish kind 36787.

## Related
- Inline track cards: `src/components/Common/Parsers/NaddrHandlers.tsx` renders 36787
  inline, keeps the observe interest open, and feeds the naddr's relay hints into the
  gossip pool + fetches author-less so hinted relays resolve the track.
