// Local playlists, persisted in IndexedDB. These are device-local (not per-account
// and never on a relay), so they survive sessions, work logged-out, and can hold
// local-file references that only mean anything on this device. Publishing a
// playlist to Nostr (kind 34139) is a separate, explicit action.
import { PlaylistTrackRef } from "./playlistModel";

const DB_NAME = "pollerama-playlists";
const STORE = "playlists";
const VERSION = 1;

export interface LocalPlaylist {
  id: string;
  title: string;
  image?: string;
  description?: string;
  tracks: PlaylistTrackRef[];
  created_at: number;
  updated_at: number;
  // Set once the playlist has been published to Nostr — the naddr of the public
  // kind-34139 copy. The local playlist itself stays local and editable.
  publishedNaddr?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllPlaylists(): Promise<LocalPlaylist[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as LocalPlaylist[]);
    req.onerror = () => reject(req.error);
  });
}

export async function putPlaylist(playlist: LocalPlaylist): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(playlist);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deletePlaylistRecord(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
