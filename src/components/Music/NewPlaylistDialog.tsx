import React, { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Stack,
} from "@mui/material";
import { usePlaylists } from "../../contexts/playlists-context";
import { PlaylistTrackRef } from "./playlistModel";

interface Props {
  open: boolean;
  onClose: () => void;
  // When set, the new playlist is created with this track already in it.
  addTrackOnCreate?: PlaylistTrackRef;
  // Called with the new playlist's dTag after a successful create.
  onCreated?: (dTag: string) => void;
}

// Create an encrypted playlist (title + optional cover URL). Encryption and
// publishing are handled by the playlists context.
const NewPlaylistDialog: React.FC<Props> = ({
  open,
  onClose,
  addTrackOnCreate,
  onCreated,
}) => {
  const { createPlaylist, addTrack } = usePlaylists();
  const [title, setTitle] = useState("");
  const [image, setImage] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitle("");
    setImage("");
    setSaving(false);
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const handleCreate = async () => {
    const name = title.trim();
    if (!name) return;
    setSaving(true);
    try {
      const pl = await createPlaylist(name, image.trim() || undefined);
      if (addTrackOnCreate) await addTrack(pl.id, addTrackOnCreate);
      onCreated?.(pl.id);
      reset();
      onClose();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <DialogTitle>New playlist</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            fullWidth
            size="small"
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
          />
          <TextField
            label="Cover image URL (optional)"
            value={image}
            onChange={(e) => setImage(e.target.value)}
            fullWidth
            size="small"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={!title.trim() || saving}
        >
          {saving ? "Creating…" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default NewPlaylistDialog;
