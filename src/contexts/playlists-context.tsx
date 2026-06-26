import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { EventTemplate } from "nostr-tools";
import { dataLayer } from "@formstr/local-relay";
import { signerManager } from "../singletons/Signer/SignerManager";
import {
  KIND_PUBLIC_PLAYLIST,
  PlaylistTrackRef,
  newPlaylistId,
  publicPlaylistNaddr,
  trackRefKey,
} from "../components/Music/playlistModel";
import {
  LocalPlaylist,
  deletePlaylistRecord,
  getAllPlaylists,
  putPlaylist,
} from "../components/Music/playlistStore";

// Result of publishing a playlist to Nostr — the public naddr plus how many local
// songs were dropped (they can't be shared), so the UI can confirm what happened.
export interface PublishResult {
  naddr: string;
  removedLocalCount: number;
}

interface PlaylistsContextInterface {
  // id → local playlist. `undefined` until the first IndexedDB load resolves.
  playlists: Map<string, LocalPlaylist> | undefined;
  createPlaylist: (title: string, image?: string) => Promise<LocalPlaylist>;
  renamePlaylist: (id: string, title: string) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  addTrack: (id: string, ref: PlaylistTrackRef) => Promise<void>;
  removeTrack: (id: string, refKey: string) => Promise<void>;
  reorderTracks: (id: string, refs: PlaylistTrackRef[]) => Promise<void>;
  // Publish a local playlist as a standard public Nostr playlist (kind 34139),
  // keeping the local copy. Requires a signer. Local tracks are dropped.
  publishPlaylist: (id: string) => Promise<PublishResult>;
}

const PlaylistsContext = createContext<PlaylistsContextInterface | null>(null);

export function PlaylistsProvider({ children }: { children: ReactNode }) {
  const [playlists, setPlaylists] = useState<
    Map<string, LocalPlaylist> | undefined
  >();

  // Playlists are device-local, not per-account, so load once on mount.
  useEffect(() => {
    let alive = true;
    getAllPlaylists()
      .then((all) => {
        if (!alive) return;
        const map = new Map<string, LocalPlaylist>();
        all
          .sort((a, b) => b.updated_at - a.updated_at)
          .forEach((pl) => map.set(pl.id, pl));
        setPlaylists(map);
      })
      .catch(() => alive && setPlaylists(new Map()));
    return () => {
      alive = false;
    };
  }, []);

  // Persist a playlist and reflect it in the in-memory map.
  const commit = useCallback(async (pl: LocalPlaylist) => {
    await putPlaylist(pl);
    setPlaylists((prev) => new Map(prev ?? []).set(pl.id, pl));
  }, []);

  // Read the current record from state, apply a change, persist. No-op if missing.
  const mutate = useCallback(
    async (id: string, change: (pl: LocalPlaylist) => LocalPlaylist) => {
      const existing = playlists?.get(id);
      if (!existing) return;
      await commit({ ...change(existing), updated_at: Date.now() });
    },
    [playlists, commit]
  );

  const createPlaylist = useCallback(
    async (title: string, image?: string) => {
      const now = Date.now();
      const pl: LocalPlaylist = {
        id: newPlaylistId(),
        title,
        image,
        tracks: [],
        created_at: now,
        updated_at: now,
      };
      await commit(pl);
      return pl;
    },
    [commit]
  );

  const renamePlaylist = useCallback(
    (id: string, title: string) => mutate(id, (pl) => ({ ...pl, title })),
    [mutate]
  );

  const addTrack = useCallback(
    (id: string, ref: PlaylistTrackRef) =>
      mutate(id, (pl) => {
        const key = trackRefKey(ref);
        if (pl.tracks.some((t) => trackRefKey(t) === key)) return pl; // already in
        return { ...pl, tracks: [...pl.tracks, ref] };
      }),
    [mutate]
  );

  const removeTrack = useCallback(
    (id: string, refKey: string) =>
      mutate(id, (pl) => ({
        ...pl,
        tracks: pl.tracks.filter((t) => trackRefKey(t) !== refKey),
      })),
    [mutate]
  );

  const reorderTracks = useCallback(
    (id: string, refs: PlaylistTrackRef[]) =>
      mutate(id, (pl) => ({ ...pl, tracks: refs })),
    [mutate]
  );

  const deletePlaylist = useCallback(async (id: string) => {
    await deletePlaylistRecord(id);
    setPlaylists((prev) => {
      if (!prev) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const publishPlaylist = useCallback(
    async (id: string): Promise<PublishResult> => {
      const pl = playlists?.get(id);
      if (!pl) throw new Error("Playlist not found");

      const nostrRefs = pl.tracks.filter((t) => t.type === "nostr");
      const removedLocalCount = pl.tracks.length - nostrRefs.length;

      const signer = await signerManager.getSigner();
      const pubkey = await signer.getPublicKey();

      // Standard public-playlist tags (Wavlake/Fountain convention): the addressable
      // `d`, a human title/image, and the track list as public `a` coordinates.
      // Local references are intentionally omitted — they can't be shared.
      const tags: string[][] = [
        ["d", pl.id],
        ["title", pl.title],
      ];
      if (pl.image) tags.push(["image", pl.image]);
      for (const ref of nostrRefs) {
        tags.push(ref.relay ? ["a", ref.coord, ref.relay] : ["a", ref.coord]);
      }

      const template: EventTemplate = {
        kind: KIND_PUBLIC_PLAYLIST,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: pl.description ?? "",
      };
      const signed = await signer.signEvent(template);
      await dataLayer.publishEvent(signed);

      const naddr = publicPlaylistNaddr(pubkey, pl.id);
      // Keep the local copy; just record that it's been published.
      await commit({ ...pl, publishedNaddr: naddr, updated_at: Date.now() });
      return { naddr, removedLocalCount };
    },
    [playlists, commit]
  );

  return (
    <PlaylistsContext.Provider
      value={{
        playlists,
        createPlaylist,
        renamePlaylist,
        deletePlaylist,
        addTrack,
        removeTrack,
        reorderTracks,
        publishPlaylist,
      }}
    >
      {children}
    </PlaylistsContext.Provider>
  );
}

export function usePlaylists() {
  const ctx = useContext(PlaylistsContext);
  if (!ctx) throw new Error("usePlaylists must be used within PlaylistsProvider");
  return ctx;
}
