import { slabListSx } from "../Common/SlabContext";
import React from "react";
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Badge,
  Button,
  CircularProgress,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import { useNavigate } from "react-router-dom";
import { nip19 } from "nostr-tools";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useDMContext } from "../../hooks/useDMContext";
import { useAppContext } from "../../hooks/useAppContext";
import { useUserContext } from "../../hooks/useUserContext";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";

dayjs.extend(relativeTime);

const ConversationList: React.FC = () => {
  const { conversations, loading, markAllAsRead, unreadTotal } = useDMContext();
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const { user } = useUserContext();
  const navigate = useNavigate();

  const sorted = Array.from(conversations.values()).sort(
    (a, b) => b.lastMessageAt - a.lastMessageAt
  );

  const getOtherParticipant = (participants: string[]): string | null => {
    if (!user) return participants[0] || null;
    return participants.find((p) => p !== user.pubkey) || participants[0] || null;
  };

  const getProfileName = (pubkey: string): string => {
    const profile = profiles?.get(pubkey);
    if (!profile) {
      fetchUserProfileThrottled(pubkey);
      return nip19.npubEncode(pubkey).slice(0, 12) + "...";
    }
    return profile.display_name || profile.name || nip19.npubEncode(pubkey).slice(0, 12) + "...";
  };

  const getProfilePicture = (pubkey: string): string => {
    const profile = profiles?.get(pubkey);
    if (!profile) {
      fetchUserProfileThrottled(pubkey);
      return DEFAULT_IMAGE_URL;
    }
    return profile.picture || DEFAULT_IMAGE_URL;
  };

  if (loading && sorted.length === 0) {
    return (
      <Box
        maxWidth={800}
        mx="auto"
        px={2}
        py={4}
        display="flex"
        justifyContent="center"
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box maxWidth={800} mx="auto" px={{ xs: 0, sm: 2 }} py={1.25}>
      {/* The block header shows the title; actions sit on the page. */}
      <Box display="flex" justifyContent="flex-end" alignItems="center" px={1.25}>
        <Box display="flex" gap={1}>
          {unreadTotal > 0 && (
            <Button
              variant="outlined"
              startIcon={<DoneAllIcon />}
              onClick={markAllAsRead}
              size="small"
            >
              Mark all read
            </Button>
          )}
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate("/messages/new")}
            size="small"
          >
            New
          </Button>
        </Box>
      </Box>

      {sorted.length === 0 ? (
        <Box textAlign="center" py={8}>
          <Typography variant="body1" color="text.secondary" gutterBottom>
            No messages yet
          </Typography>
          <Button
            variant="outlined"
            onClick={() => navigate("/messages/new")}
          >
            Start a conversation
          </Button>
        </Box>
      ) : (
        <List disablePadding sx={slabListSx}>
          {sorted.map((conv) => {
            const otherPubkey = getOtherParticipant(conv.participants);
            if (!otherPubkey) return null;

            const lastMsg = conv.messages[conv.messages.length - 1];
            const preview =
              lastMsg?.content?.length > 50
                ? lastMsg.content.slice(0, 50) + "..."
                : lastMsg?.content || "";

            return (
              <ListItem
                key={conv.id}
                onClick={() =>
                  navigate(`/messages/${nip19.npubEncode(otherPubkey)}`)
                }
                sx={{
                  cursor: "pointer",
                  py: 1.25,
                  "& + &": { borderTop: 1, borderColor: "divider" },
                  "&:hover": {
                    backgroundColor: "action.hover",
                  },
                }}
              >
                <ListItemAvatar>
                  <Badge
                    badgeContent={conv.unreadCount}
                    color="secondary"
                    invisible={conv.unreadCount === 0}
                  >
                    <Avatar src={getProfilePicture(otherPubkey)} sx={{ width: 46, height: 46 }} />
                  </Badge>
                </ListItemAvatar>
                <ListItemText
                  primary={
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: 15 }}>
                      {getProfileName(otherPubkey)}
                    </Typography>
                  }
                  secondary={
                    <Box
                      component="span"
                      display="flex"
                      justifyContent="space-between"
                    >
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        noWrap
                        sx={{ flex: 1, mr: 1 }}
                      >
                        {preview}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ whiteSpace: "nowrap" }}
                      >
                        {dayjs.unix(conv.lastMessageAt).fromNow()}
                      </Typography>
                    </Box>
                  }
                />
              </ListItem>
            );
          })}
        </List>
      )}
    </Box>
  );
};

export default ConversationList;
