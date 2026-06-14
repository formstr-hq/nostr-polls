import React, { useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Box,
  Chip,
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
import { Event } from "nostr-tools/lib/types/core";
import { nip19 } from "nostr-tools";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../../../hooks/useAppContext";
import { useBackClose } from "../../../hooks/useBackClose";
import { openProfileTab } from "../../../nostr";
import { DEFAULT_IMAGE_URL } from "../../../utils/constants";
import { Nip05Badge } from "../Nip05Badge";

interface ReactionsDetailsModalProps {
  open: boolean;
  onClose: () => void;
  reactions: Event[];
}

const RenderEmoji: React.FC<{ content: string; tags?: string[][]; size?: number }> = ({
  content,
  tags,
  size = 18,
}) => {
  const match = content.match(/^:([a-zA-Z0-9_]+):$/);
  if (match && tags) {
    const shortcode = match[1];
    const emojiTag = tags.find((t) => t[0] === "emoji" && t[1] === shortcode);
    if (emojiTag && emojiTag[2]) {
      return (
        <img
          src={emojiTag[2]}
          alt={`:${shortcode}:`}
          title={`:${shortcode}:`}
          style={{ height: size, width: "auto", verticalAlign: "middle" }}
        />
      );
    }
  }
  return <span style={{ fontSize: size }}>{content}</span>;
};

const ReactionsDetailsModal: React.FC<ReactionsDetailsModalProps> = ({
  open,
  onClose,
  reactions,
}) => {
  const navigate = useNavigate();
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const [filterEmoji, setFilterEmoji] = useState<string | null>(null);
  useBackClose(open, onClose);

  useEffect(() => {
    if (!open) return;
    reactions.forEach((r) => {
      if (!profiles?.get(r.pubkey)) fetchUserProfileThrottled(r.pubkey);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reactions.length]);

  useEffect(() => {
    if (!open) setFilterEmoji(null);
  }, [open]);

  const emojiCounts = useMemo(() => {
    const counts: Record<string, { count: number; tags?: string[][] }> = {};
    reactions.forEach((r) => {
      if (!counts[r.content]) counts[r.content] = { count: 0, tags: r.tags };
      counts[r.content].count += 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([emoji, data]) => ({ emoji, count: data.count, tags: data.tags }));
  }, [reactions]);

  const filtered = filterEmoji
    ? reactions.filter((r) => r.content === filterEmoji)
    : reactions;

  const sorted = [...filtered].sort((a, b) => b.created_at - a.created_at);

  const handleProfileClick = (pk: string) => {
    onClose();
    openProfileTab(nip19.npubEncode(pk), navigate);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          pb: 1,
        }}
      >
        <Box>
          <Typography variant="h6">Reactions</Typography>
          <Typography variant="body2" color="text.secondary">
            {reactions.length} {reactions.length === 1 ? "reaction" : "reactions"}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      {emojiCounts.length > 1 && (
        <Box
          sx={{
            display: "flex",
            gap: 0.5,
            flexWrap: "wrap",
            px: 2,
            pb: 1,
          }}
        >
          <Chip
            size="small"
            label={`All ${reactions.length}`}
            color={filterEmoji === null ? "primary" : "default"}
            variant={filterEmoji === null ? "filled" : "outlined"}
            onClick={() => setFilterEmoji(null)}
          />
          {emojiCounts.map(({ emoji, count, tags }) => (
            <Chip
              key={emoji}
              size="small"
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <RenderEmoji content={emoji} tags={tags} size={16} />
                  <span>{count}</span>
                </Box>
              }
              color={filterEmoji === emoji ? "primary" : "default"}
              variant={filterEmoji === emoji ? "filled" : "outlined"}
              onClick={() => setFilterEmoji(emoji)}
            />
          ))}
        </Box>
      )}

      <DialogContent sx={{ p: 0 }}>
        {sorted.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 3, py: 3 }}>
            No reactions yet.
          </Typography>
        ) : (
          <List dense disablePadding>
            {sorted.map((r) => {
              const profile = profiles?.get(r.pubkey);
              const npub = nip19.npubEncode(r.pubkey);
              const name =
                profile?.display_name || profile?.name || npub.slice(0, 8) + "…";

              return (
                <ListItem
                  key={r.id}
                  sx={{ px: 2, py: 1, alignItems: "flex-start" }}
                  secondaryAction={
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        pt: 0.5,
                      }}
                    >
                      <RenderEmoji content={r.content} tags={r.tags} size={20} />
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

export default ReactionsDetailsModal;
