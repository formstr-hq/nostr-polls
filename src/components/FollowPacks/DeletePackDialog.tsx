import React, { useState } from "react";
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import { Event } from "nostr-tools";
import { useListContext } from "../../hooks/useListContext";
import { useNotification } from "../../contexts/notification-context";
import { getPackMeta } from "./packUtils";

interface Props {
  open: boolean;
  pack: Event;
  onClose: () => void;
  onDeleted: () => void;
}

export const DeletePackDialog: React.FC<Props> = ({ open, pack, onClose, onDeleted }) => {
  const { deleteFollowPack } = useListContext();
  const { showNotification } = useNotification();
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await deleteFollowPack(pack);
      // NIP-09 is a request: most relays honour it, some keep the event.
      showNotification("Deletion requested", "success");
      onDeleted();
    } catch (e) {
      console.error("Failed to delete pack:", e);
      showNotification("Couldn't delete the pack. Try again.", "error");
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose}>
      <DialogTitle>Delete “{getPackMeta(pack).title}”?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          This asks relays to remove the pack. Most will, but some may keep a copy, and people who
          already followed its members keep following them.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button color="error" onClick={confirm} disabled={busy}>
          {busy ? <CircularProgress size={18} color="inherit" /> : "Delete"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
