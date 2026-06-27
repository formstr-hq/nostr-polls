import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  Stack,
  Typography,
} from "@mui/material";
import LibraryMusicIcon from "@mui/icons-material/LibraryMusic";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import RefreshIcon from "@mui/icons-material/Refresh";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import CloseIcon from "@mui/icons-material/Close";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import { Capacitor } from "@capacitor/core";
import { usePlayback, PlaybackTrack } from "../../contexts/PlaybackContext";
import { isAndroidNative } from "../../utils/platform";
import { MusicLibrary } from "../../plugins/musicLibrary";
import {
  fsaSupported,
  getAllEntries,
  putEntries,
  deleteEntry,
  computeFingerprint,
  StoredEntry,
} from "./localMusicStore";
import {
  registerEntry,
  registerUrl,
  resolveUrl,
  release,
} from "./localTrackResolver";
import AddToPlaylistButton from "./AddToPlaylistButton";

interface LocalTrack {
  id: string;
  name: string;
  title: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  // Content fingerprint — present for web entries added with the new store; lets a
  // track be referenced from a playlist. Absent for native (MediaStore) tracks and
  // legacy entries.
  fingerprint?: string;
  // Native (Android MediaStore) content:// URI — stable per-file and directly
  // playable, so it's what a playlist stores for a native track. Absent on web.
  uri?: string;
  // Display-only album-art URL (native: convertFileSrc'd content URI). Absent on
  // web and for native tracks with no embedded cover.
  artworkUrl?: string;
}

// "3:07" from a millisecond duration; empty when unknown.
const formatDuration = (ms?: number): string => {
  if (!ms || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

type NativeState = "idle" | "loading" | "needsPermission" | "denied" | "done";

const AUDIO_EXT = /\.(mp3|m4a|flac|wav|ogg|oga|aac|opus)$/i;

// "Artist - Title.mp3" → { artist, title }; otherwise the whole stem is the title.
const parseName = (filename: string): { title: string; artist?: string } => {
  const stem = filename.replace(/\.[^./\\]+$/, "");
  const dash = stem.match(/^(.+?)\s*[-–]\s*(.+)$/);
  if (dash) return { artist: dash[1].trim(), title: dash[2].trim() };
  return { title: stem };
};

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Math.floor(performance.now())}-${Math.floor(performance.now() * 1000)}`;

const toLocalTrack = (e: StoredEntry): LocalTrack => ({
  id: e.id,
  name: e.name,
  fingerprint: e.fingerprint,
  ...parseName(e.name),
});

interface LocalMusicProps {
  // Rendered at the top of the scroll container so it scrolls away with the list
  // (used to keep the playlist strips consistent with the other music tabs).
  header?: React.ReactNode;
}

const LocalMusic: React.FC<LocalMusicProps> = ({ header }) => {
  const { current, playing, playQueue, toggle } = usePlayback();
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  const [nativeState, setNativeState] = useState<NativeState>("idle");
  // Progress of a bulk import while files are fingerprinted one at a time.
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const native = isAndroidNative();
  const supportsFsa = fsaSupported();
  // Album-art URIs that failed to load (no embedded cover / unreadable); fall back
  // to the music-note placeholder so a missing cover doesn't leave a blank box.
  const [brokenArt, setBrokenArt] = useState<Set<string>>(new Set());

  // ── Native (Android MediaStore) ──────────────────────────────────────────
  const scanNative = useCallback(async () => {
    setNativeState("loading");
    try {
      let granted = (await MusicLibrary.checkPermission()).granted;
      if (!granted) granted = (await MusicLibrary.requestPermission()).granted;
      if (!granted) { setNativeState("denied"); return; }
      const { tracks: nativeTracks } = await MusicLibrary.getTracks();
      // Hand ExoPlayer the raw content:// URI — it reads those directly. (Do NOT
      // convertFileSrc here: that yields a localhost URL only the WebView's
      // Capacitor server can resolve, which the native player can't fetch.)
      nativeTracks.forEach((t) => registerUrl(t.id, t.uri));
      setTracks(
        nativeTracks.map((t) => ({
          id: t.id,
          name: t.title,
          title: t.title || "Unknown title",
          artist: t.artist && t.artist !== "<unknown>" ? t.artist : undefined,
          album: t.album && t.album !== "<unknown>" ? t.album : undefined,
          durationMs: t.durationMs,
          // Keep the content:// URI so the track can be added to a playlist (which
          // stores the URI directly — it's stable and playable on this device).
          uri: t.uri,
          // Album art DOES go through the WebView (an <img>), so convertFileSrc is
          // correct here — unlike the audio URI above.
          artworkUrl: t.artworkUri
            ? Capacitor.convertFileSrc(t.artworkUri)
            : undefined,
        }))
      );
      setNativeState("done");
    } catch {
      setNativeState("denied");
    }
  }, []);

  // On native, auto-scan if permission is already granted (no prompt without a
  // gesture); otherwise wait for the user to tap "Scan device music".
  useEffect(() => {
    if (!native) return;
    let alive = true;
    MusicLibrary.checkPermission()
      .then(({ granted }) => {
        if (!alive) return;
        if (granted) void scanNative();
        else setNativeState("needsPermission");
      })
      .catch(() => alive && setNativeState("needsPermission"));
    return () => { alive = false; };
  }, [native, scanNative]);

  // ── Web (File System Access handles + blob fallback) ─────────────────────
  useEffect(() => {
    if (native) return;
    let alive = true;
    getAllEntries().then((entries) => {
      if (!alive) return;
      entries.forEach(registerEntry);
      setTracks(entries.map(toLocalTrack));
    }).catch(() => {});
    return () => { alive = false; };
  }, [native]);

  const addEntries = useCallback(async (entries: StoredEntry[]) => {
    entries.forEach(registerEntry);
    await putEntries(entries);
    setTracks((prev) => [...prev, ...entries.map(toLocalTrack)]);
  }, []);

  // Import items one at a time, fingerprinting each (peak memory = one file), with
  // a progress readout for big folder picks. `build` produces a StoredEntry —
  // including its SHA-256 — from a handle or a File.
  const importSequentially = useCallback(
    async <T,>(items: T[], build: (item: T) => Promise<StoredEntry>) => {
      if (!items.length) return;
      setImporting({ done: 0, total: items.length });
      const built: StoredEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        try {
          built.push(await build(items[i]));
        } catch {
          /* unreadable file — skip it */
        }
        setImporting({ done: i + 1, total: items.length });
      }
      setImporting(null);
      if (built.length) await addEntries(built);
    },
    [addEntries]
  );

  const buildFromHandle = async (handle: any): Promise<StoredEntry> => {
    // The picker just granted read, so getFile() here needs no extra prompt.
    const file = await handle.getFile();
    const fingerprint = await computeFingerprint(file);
    return { id: newId(), name: handle.name, handle, fingerprint };
  };

  const buildFromFile = async (file: File): Promise<StoredEntry> => {
    const fingerprint = await computeFingerprint(file);
    return { id: newId(), name: file.name, blob: file, fingerprint };
  };

  // FSA: pick individual audio files, persisted as references (no copy).
  const pickFiles = useCallback(async () => {
    try {
      const handles = await (window as any).showOpenFilePicker({
        multiple: true,
        types: [{ description: "Audio", accept: { "audio/*": [".mp3", ".m4a", ".flac", ".wav", ".ogg", ".aac", ".opus"] } }],
      });
      await importSequentially(handles as any[], buildFromHandle);
    } catch { /* user cancelled */ }
  }, [importSequentially]);

  // FSA: pick a folder; keep references to its audio files (no copy).
  const pickFolder = useCallback(async () => {
    try {
      const dir = await (window as any).showDirectoryPicker();
      const handles: any[] = [];
      for await (const entry of dir.values()) {
        if (entry.kind === "file" && AUDIO_EXT.test(entry.name)) {
          handles.push(entry);
        }
      }
      await importSequentially(handles, buildFromHandle);
    } catch { /* user cancelled */ }
  }, [importSequentially]);

  // Fallback (no FSA — Firefox/Safari): persist the File blob itself (a copy),
  // since those browsers expose no handle to reference.
  const addFromInput = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const audioFiles = Array.from(fileList).filter((f) => f.type.startsWith("audio/"));
    if (audioFiles.length) void importSequentially(audioFiles, buildFromFile);
  }, [importSequentially]);

  const playFrom = useCallback(async (index: number) => {
    // Resolve every track we can, then play the chosen one within that queue so
    // the global player's next/prev walk the local list.
    const resolved = await Promise.all(tracks.map((t) => resolveUrl(t.id)));
    const queue: PlaybackTrack[] = [];
    let startAt = 0;
    tracks.forEach((t, i) => {
      const url = resolved[i];
      if (!url) return;
      if (i === index) startAt = queue.length;
      queue.push({ id: t.id, sources: [url], title: t.title, artist: t.artist });
    });
    if (queue.length) playQueue(queue, startAt);
  }, [tracks, playQueue]);

  const onRowClick = useCallback((index: number, id: string) => {
    if (current?.id === id) toggle();
    else void playFrom(index);
  }, [current, toggle, playFrom]);

  const removeTrack = useCallback(async (id: string) => {
    release(id);
    await deleteEntry(id);
    setTracks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <Box sx={{ maxWidth: 700, mx: "auto", p: 2, height: "100%", overflowY: "auto" }}>
      {/* Bleed past the container padding so the strips align with the feed tabs. */}
      {header && <Box sx={{ mx: -2, mt: -2, mb: 1 }}>{header}</Box>}
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        {native ? (
          <Button
            variant="outlined"
            size="small"
            startIcon={nativeState === "loading" ? <CircularProgress size={16} /> : <RefreshIcon />}
            onClick={scanNative}
            disabled={nativeState === "loading"}
            sx={{ textTransform: "none", borderRadius: 2 }}
          >
            {nativeState === "done" ? "Rescan" : "Scan device music"}
          </Button>
        ) : supportsFsa ? (
          <>
            <Button variant="outlined" size="small" startIcon={<LibraryMusicIcon />} onClick={pickFiles} disabled={!!importing} sx={{ textTransform: "none", borderRadius: 2 }}>
              Add files
            </Button>
            <Button variant="outlined" size="small" startIcon={<FolderOpenIcon />} onClick={pickFolder} disabled={!!importing} sx={{ textTransform: "none", borderRadius: 2 }}>
              Add folder
            </Button>
          </>
        ) : (
          <Button variant="outlined" size="small" startIcon={<LibraryMusicIcon />} onClick={() => fileInputRef.current?.click()} disabled={!!importing} sx={{ textTransform: "none", borderRadius: 2 }}>
            Add files
          </Button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          hidden
          onChange={(e) => { addFromInput(e.target.files); e.target.value = ""; }}
        />
      </Stack>

      {importing && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
            Importing {importing.done} / {importing.total}…
          </Typography>
          <LinearProgress
            variant="determinate"
            value={importing.total ? (importing.done / importing.total) * 100 : 0}
          />
        </Box>
      )}

      {!native && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          {supportsFsa
            ? "Your library is remembered as a reference to the files on disk — nothing is copied or uploaded."
            : "Your files are saved in this browser so they persist between visits. They stay on your device — nothing is uploaded."}
        </Typography>
      )}

      {native && nativeState === "denied" && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Music access is off. Tap “Scan device music” and allow access to see your tracks.
        </Typography>
      )}

      {native && nativeState === "loading" ? (
        <Box display="flex" justifyContent="center" py={8}>
          <CircularProgress size={24} />
        </Box>
      ) : tracks.length === 0 ? (
        <Box display="flex" flexDirection="column" alignItems="center" gap={1} py={8}>
          <MusicNoteIcon color="disabled" sx={{ fontSize: 40 }} />
          <Typography variant="body2" color="text.secondary" textAlign="center">
            {native
              ? nativeState === "done"
                ? "No music found on your device."
                : "Scan your device to browse and play your music."
              : "Add audio files from your device to play them here."}
          </Typography>
        </Box>
      ) : (
        <List dense disablePadding>
          {tracks.map((t, i) => {
            const isCurrent = current?.id === t.id;
            const showArt = t.artworkUrl && !brokenArt.has(t.id);
            const duration = formatDuration(t.durationMs);
            // Prefer the album under the artist line when both exist.
            const subtitle = [t.artist, t.album].filter(Boolean).join(" • ");
            return (
              <ListItemButton key={t.id} selected={isCurrent} onClick={() => onRowClick(i, t.id)} sx={{ borderRadius: 1, gap: 1 }}>
                <Box sx={{ position: "relative", width: 44, height: 44, flexShrink: 0 }}>
                  {showArt ? (
                    <Box
                      component="img"
                      src={t.artworkUrl}
                      alt=""
                      onError={() =>
                        setBrokenArt((prev) => new Set(prev).add(t.id))
                      }
                      sx={{ width: 44, height: 44, borderRadius: 1, objectFit: "cover", display: "block" }}
                    />
                  ) : (
                    <Box
                      sx={{
                        width: 44,
                        height: 44,
                        borderRadius: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        bgcolor: "action.hover",
                      }}
                    >
                      <MusicNoteIcon color="disabled" fontSize="small" />
                    </Box>
                  )}
                  {/* Play/pause overlays the cover so each row stays compact. */}
                  <Box
                    sx={{
                      position: "absolute",
                      inset: 0,
                      display: isCurrent ? "flex" : "none",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 1,
                      bgcolor: "rgba(0,0,0,0.45)",
                      color: "common.white",
                    }}
                  >
                    {isCurrent && playing ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
                  </Box>
                </Box>
                <Box minWidth={0} flex={1}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: isCurrent ? 600 : 400 }}>
                    {t.title}
                  </Typography>
                  {subtitle && (
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                      {subtitle}
                    </Typography>
                  )}
                </Box>
                {duration && (
                  <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                    {duration}
                  </Typography>
                )}
                {(t.fingerprint || t.uri) && (
                  <Box onClick={(e) => e.stopPropagation()}>
                    <AddToPlaylistButton
                      track={{
                        type: "local",
                        // Native tracks ref by content:// URI; web tracks by
                        // content fingerprint. Exactly one is set.
                        ...(t.uri
                          ? { uri: t.uri }
                          : { fingerprint: t.fingerprint }),
                        title: t.title,
                        artist: t.artist,
                        durationMs: t.durationMs,
                        filename: t.name,
                      }}
                    />
                  </Box>
                )}
                {!native && (
                  <IconButton size="small" aria-label="Remove" onClick={(e) => { e.stopPropagation(); void removeTrack(t.id); }}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                )}
              </ListItemButton>
            );
          })}
        </List>
      )}
    </Box>
  );
};

export default LocalMusic;
