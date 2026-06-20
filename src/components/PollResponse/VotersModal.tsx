import React, { useEffect, useRef } from "react";
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
  Tooltip,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import { nip19 } from "nostr-tools";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../../hooks/useAppContext";
import { useBackClose } from "../../hooks/useBackClose";
import { openProfileTab } from "../../nostr";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";
import { Nip05Badge } from "../Common/Nip05Badge";
import { OptionResult } from "../../hooks/usePollResults";
import { BAR_COLORS } from "./barColors";

interface VotersModalProps {
  open: boolean;
  onClose: () => void;
  options: [string, string, string][];
  results: Map<string, OptionResult>;
  totalVotes: number;
  focusOptionId?: string | null;
}

const VotersModal: React.FC<VotersModalProps> = ({
  open,
  onClose,
  options,
  results,
  totalVotes,
  focusOptionId,
}) => {
  const navigate = useNavigate();
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  useBackClose(open, onClose);

  const allPubkeys = Array.from(results.values()).flatMap((r) => r.responders);
  useEffect(() => {
    if (!open) return;
    allPubkeys.forEach((pk) => {
      if (!profiles?.get(pk)) fetchUserProfileThrottled(pk);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, allPubkeys.length]);

  const optionRefs = useRef<Map<string, HTMLElement>>(new Map());
  useEffect(() => {
    if (!open || !focusOptionId) return;
    const el = optionRefs.current.get(focusOptionId);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }, [open, focusOptionId]);

  const handleProfileClick = (pk: string) => {
    onClose();
    openProfileTab(nip19.npubEncode(pk), navigate);
  };

  const handleMessageClick = (pk: string) => {
    onClose();
    navigate(`/messages/${nip19.npubEncode(pk)}`);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1 }}
      >
        <Box>
          <Typography variant="h6">Voters</Typography>
          {totalVotes > 0 && (
            <Typography variant="body2" color="text.secondary">
              {totalVotes} {totalVotes === 1 ? "vote" : "votes"}
            </Typography>
          )}
        </Box>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        {totalVotes === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 3, py: 3 }}>
            No votes yet.
          </Typography>
        ) : (
          options.map((option, optionIndex) => {
            const [, optionId, label] = option;
            const result = results.get(optionId);
            if (!result || result.responders.length === 0) return null;
            const color = BAR_COLORS[optionIndex % BAR_COLORS.length];

            return (
              <Box
                key={optionId}
                ref={(el: HTMLElement | null) => {
                  if (el) optionRefs.current.set(optionId, el);
                  else optionRefs.current.delete(optionId);
                }}
              >
                <Box
                  sx={{
                    px: 2,
                    py: 0.75,
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    borderBottom: 1,
                    borderColor: "divider",
                    position: "sticky",
                    top: 0,
                    bgcolor: "background.paper",
                    zIndex: 1,
                  }}
                >
                  <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
                  <Typography variant="subtitle2" noWrap sx={{ flex: 1 }}>
                    {label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {result.count} · {result.percentage.toFixed(0)}%
                  </Typography>
                </Box>

                <List dense disablePadding>
                  {result.responders.map((pk) => {
                    const profile = profiles?.get(pk);
                    const npub = nip19.npubEncode(pk);
                    const name =
                      profile?.display_name || profile?.name || npub.slice(0, 8) + "…";
                    // Per-event relay provenance now lives in the worker and is
                    // not exposed to the app (see useEventRelays).
                    const voteRelays: string[] = [];

                    return (
                      <ListItem
                        key={pk}
                        sx={{ px: 2, py: 0.5, alignItems: "flex-start" }}
                        secondaryAction={
                          <Tooltip title="Send message">
                            <IconButton size="small" edge="end" onClick={() => handleMessageClick(pk)} sx={{ mt: 0.5 }}>
                              <ChatBubbleOutlineIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        }
                      >
                        <ListItemAvatar sx={{ minWidth: 44, mt: 0.5 }}>
                          <Avatar
                            src={profile?.picture || DEFAULT_IMAGE_URL}
                            sx={{ width: 36, height: 36, cursor: "pointer" }}
                            onClick={() => handleProfileClick(pk)}
                          />
                        </ListItemAvatar>
                        <ListItemText
                          primary={
                            <Typography
                              variant="body2"
                              fontWeight={500}
                              noWrap
                              sx={{ cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
                              onClick={() => handleProfileClick(pk)}
                            >
                              {name}
                            </Typography>
                          }
                          secondary={
                            <Box component="span" sx={{ display: "flex", flexDirection: "column", gap: 0.4 }}>
                              {profile?.nip05 ? (
                                <Nip05Badge nip05={profile.nip05} pubkey={pk} />
                              ) : (
                                <Typography variant="caption" color="text.secondary" noWrap>
                                  {npub.slice(0, 16)}…
                                </Typography>
                              )}
                              {voteRelays.length > 0 && (
                                <Box component="span" sx={{ display: "flex", flexWrap: "wrap", gap: 0.4 }}>
                                  {voteRelays.map((r) => {
                                    const host = r.replace(/^wss?:\/\//, "").replace(/\/$/, "");
                                    return (
                                      <Box
                                        key={r}
                                        component="span"
                                        sx={{
                                          fontSize: "0.6rem",
                                          px: 0.6,
                                          py: 0.1,
                                          borderRadius: "4px",
                                          bgcolor: "action.hover",
                                          color: "text.secondary",
                                          fontFamily: "monospace",
                                          lineHeight: 1.6,
                                        }}
                                      >
                                        {host}
                                      </Box>
                                    );
                                  })}
                                </Box>
                              )}
                            </Box>
                          }
                        />
                      </ListItem>
                    );
                  })}
                </List>
              </Box>
            );
          })
        )}
      </DialogContent>
    </Dialog>
  );
};

export default VotersModal;
