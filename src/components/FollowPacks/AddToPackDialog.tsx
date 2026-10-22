import React, { useState } from "react";
import {
  Box,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogTitle,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import AddIcon from "@mui/icons-material/AddRounded";
import { nip19 } from "nostr-tools";
import { useNavigate } from "react-router-dom";
import { useListContext } from "../../hooks/useListContext";
import { useUserContext } from "../../hooks/useUserContext";
import { useNotification } from "../../contexts/notification-context";
import { getPackMeta, KIND_FOLLOW_PACK } from "./packUtils";

interface Props {
  open: boolean;
  pubkey: string;
  name: string;
  onClose: () => void;
}

/** Toggle a person's membership in each of the user's own packs. */
export const AddToPackDialog: React.FC<Props> = ({ open, pubkey, name, onClose }) => {
  const { lists, publishFollowPack } = useListContext();
  const { user } = useUserContext();
  const { showNotification } = useNotification();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const myPacks = Array.from(lists?.values() || [])
    .filter((e) => e.kind === KIND_FOLLOW_PACK && e.pubkey === user?.pubkey)
    .sort((a, b) => b.created_at - a.created_at);

  const toggle = async (packId: string) => {
    const pack = myPacks.find((p) => p.id === packId);
    if (!pack || busy) return;
    const meta = getPackMeta(pack);
    const inPack = meta.members.includes(pubkey);
    setBusy(pack.id);
    try {
      await publishFollowPack({
        identifier: meta.identifier,
        title: meta.title,
        description: meta.description,
        image: meta.image,
        members: inPack ? meta.members.filter((m) => m !== pubkey) : [...meta.members, pubkey],
        base: pack,
      });
      showNotification(inPack ? `Removed from ${meta.title}` : `Added to ${meta.title}`, "success");
    } catch (e) {
      console.error("Failed to update pack:", e);
      showNotification("Couldn't update the pack. Try again.", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Add {name} to a pack</DialogTitle>
      <List sx={{ pt: 0 }}>
        {myPacks.map((pack) => {
          const meta = getPackMeta(pack);
          const checked = meta.members.includes(pubkey);
          return (
            <ListItemButton key={pack.id} onClick={() => toggle(pack.id)} disabled={!!busy}>
              <ListItemIcon sx={{ minWidth: 44 }}>
                {busy === pack.id ? (
                  <Box sx={{ width: 42, display: "flex", justifyContent: "center" }}>
                    <CircularProgress size={20} />
                  </Box>
                ) : (
                  <Checkbox edge="start" checked={checked} tabIndex={-1} disableRipple />
                )}
              </ListItemIcon>
              <ListItemText
                primary={meta.title}
                secondary={`${meta.members.length} member${meta.members.length === 1 ? "" : "s"}`}
              />
            </ListItemButton>
          );
        })}
        <ListItemButton
          onClick={() => {
            onClose();
            navigate(`/feeds/follow-packs/new?add=${nip19.npubEncode(pubkey)}`);
          }}
        >
          <ListItemIcon sx={{ minWidth: 44 }}>
            <AddIcon />
          </ListItemIcon>
          <ListItemText primary={`New pack with ${name}`} />
        </ListItemButton>
      </List>
    </Dialog>
  );
};
