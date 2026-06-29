import React, { useEffect, useState } from "react";
import {
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Tooltip,
  CircularProgress,
} from "@mui/material";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import { dataLayer } from "@formstr/local-relay";
import { usePlaylists } from "../../contexts/playlists-context";
import { PlaylistTrackRef, trackRefKey } from "./playlistModel";
import NewPlaylistDialog from "./NewPlaylistDialog";

interface Props {
  track: PlaylistTrackRef;
  /** The source track event's id, used to learn which relay it came from so the
   *  saved ref carries a relay hint (resolves later + survives publishing). */
  sourceEventId?: string;
  /** Optional size override for the icon button. */
  size?: "small" | "medium";
}

// A compact "+" that drops a menu of the user's (local) playlists — a check marks
// ones the track is already in — plus "New playlist…". Playlists are local, so
// this works logged-out too. Used on track cards and local rows.
const AddToPlaylistButton: React.FC<Props> = ({
  track,
  sourceEventId,
  size = "small",
}) => {
  const { playlists, addTrack } = usePlaylists();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [relayHint, setRelayHint] = useState<string | undefined>();

  // Learn the source relay (cache-only, no network) so the stored ref records
  // where the track lives — used to seed the gossip pool when the playlist is
  // reopened, and written as an `["a", coord, relay]` hint when it's published.
  useEffect(() => {
    if (track.type !== "nostr" || track.relay || !sourceEventId) return;
    let alive = true;
    dataLayer
      .seenOn(sourceEventId)
      .then((relays) => {
        if (alive && relays[0]) setRelayHint(relays[0]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [track, sourceEventId]);

  const effectiveTrack: PlaylistTrackRef =
    track.type === "nostr" && relayHint && !track.relay
      ? { ...track, relay: relayHint }
      : track;

  const open = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setAnchor(e.currentTarget);
  };

  const close = () => setAnchor(null);

  const key = trackRefKey(effectiveTrack);
  const list = playlists ? Array.from(playlists.values()) : [];

  const handleAdd = async (dTag: string) => {
    setBusy(dTag);
    try {
      await addTrack(dTag, effectiveTrack);
    } finally {
      setBusy(null);
      close();
    }
  };

  return (
    <>
      <Tooltip title="Add to playlist">
        <IconButton size={size} aria-label="Add to playlist" onClick={open}>
          <PlaylistAddIcon fontSize={size === "small" ? "small" : "medium"} />
        </IconButton>
      </Tooltip>

      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close}>
        {list.map((pl) => {
          const already = pl.tracks.some((t) => trackRefKey(t) === key);
          return (
            <MenuItem
              key={pl.id}
              disabled={already || busy === pl.id}
              onClick={() => handleAdd(pl.id)}
            >
              {(already || busy === pl.id) && (
                <ListItemIcon>
                  {busy === pl.id ? (
                    <CircularProgress size={16} />
                  ) : (
                    <CheckIcon fontSize="small" />
                  )}
                </ListItemIcon>
              )}
              <ListItemText
                inset={!already && busy !== pl.id}
                primary={pl.title}
              />
            </MenuItem>
          );
        })}
        {list.length > 0 && <Divider />}
        <MenuItem
          onClick={() => {
            close();
            setDialogOpen(true);
          }}
        >
          <ListItemIcon>
            <AddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="New playlist…" />
        </MenuItem>
      </Menu>

      <NewPlaylistDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        // Add this track to the freshly-created playlist.
        addTrackOnCreate={effectiveTrack}
      />
    </>
  );
};

export default AddToPlaylistButton;
