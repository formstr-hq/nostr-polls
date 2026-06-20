import React, { useEffect, useMemo } from "react";
import {
  Avatar,
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import RepeatIcon from "@mui/icons-material/Repeat";
import { Event } from "nostr-tools/lib/types/core";
import { nip19 } from "nostr-tools";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../../../hooks/useAppContext";
import { useBackClose } from "../../../hooks/useBackClose";
import { openProfileTab } from "../../../nostr";
import { DEFAULT_IMAGE_URL } from "../../../utils/constants";
import { Nip05Badge } from "../Nip05Badge";

interface RepostsDetailsModalProps {
  open: boolean;
  onClose: () => void;
  reposts: Event[];
}

const RepostsDetailsModal: React.FC<RepostsDetailsModalProps> = ({
  open,
  onClose,
  reposts,
}) => {
  const navigate = useNavigate();
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  useBackClose(open, onClose);

  // One entry per reposter, keeping their most recent repost.
  const reposters = useMemo(() => {
    const byPubkey = new Map<string, Event>();
    for (const r of reposts) {
      const existing = byPubkey.get(r.pubkey);
      if (!existing || r.created_at > existing.created_at) byPubkey.set(r.pubkey, r);
    }
    return Array.from(byPubkey.values()).sort((a, b) => b.created_at - a.created_at);
  }, [reposts]);

  useEffect(() => {
    if (!open) return;
    reposters.forEach((r) => {
      if (!profiles?.get(r.pubkey)) fetchUserProfileThrottled(r.pubkey);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reposters.length]);

  const handleProfileClick = (pk: string) => {
    onClose();
    openProfileTab(nip19.npubEncode(pk), navigate);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1 }}
      >
        <Box>
          <Typography variant="h6">Reposts</Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <RepeatIcon sx={{ fontSize: "0.9rem" }} color="primary" />
            <Typography variant="body2" color="text.secondary">
              {reposters.length} {reposters.length === 1 ? "repost" : "reposts"}
            </Typography>
          </Box>
        </Box>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        {reposters.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 3, py: 3 }}>
            No reposts yet.
          </Typography>
        ) : (
          <List dense disablePadding>
            {reposters.map((r) => {
              const profile = profiles?.get(r.pubkey);
              const npub = nip19.npubEncode(r.pubkey);
              const name =
                profile?.display_name || profile?.name || npub.slice(0, 8) + "…";

              return (
                <ListItem
                  key={r.id}
                  sx={{ px: 2, py: 1, alignItems: "flex-start" }}
                  secondaryAction={
                    <Box sx={{ display: "flex", alignItems: "center", pt: 0.5 }}>
                      <RepeatIcon sx={{ fontSize: "1rem" }} color="primary" />
                    </Box>
                  }
                >
                  <ListItemAvatar sx={{ minWidth: 44, mt: 0.5 }}>
                    <Avatar
                      src={profile?.picture || DEFAULT_IMAGE_URL}
                      sx={{ width: 36, height: 36, cursor: "pointer" }}
                      onClick={() => handleProfileClick(r.pubkey)}
                    />
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Typography
                        variant="body2"
                        fontWeight={500}
                        noWrap
                        sx={{
                          cursor: "pointer",
                          "&:hover": { textDecoration: "underline" },
                          pr: 5,
                        }}
                        onClick={() => handleProfileClick(r.pubkey)}
                      >
                        {name}
                      </Typography>
                    }
                    secondary={
                      <Box
                        component="span"
                        sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}
                      >
                        {profile?.nip05 ? (
                          <Nip05Badge nip05={profile.nip05} pubkey={r.pubkey} />
                        ) : (
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {npub.slice(0, 16)}…
                          </Typography>
                        )}
                      </Box>
                    }
                  />
                </ListItem>
              );
            })}
          </List>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default RepostsDetailsModal;
