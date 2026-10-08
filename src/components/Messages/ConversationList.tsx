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

  const sorted = React.useMemo(
    () =>
      Array.from(conversations.values()).sort(
        (a, b) => b.lastMessageAt - a.lastMessageAt
      ),
    [conversations]
  );

  // Profile fetches are side effects — they don't belong in the render body
  // (which can run many times over). Collect missing participants per state
  // change and fetch them in an effect instead.
  React.useEffect(() => {
    for (const conv of sorted) {
      for (const p of conv.participants) {
        if (!profiles?.get(p)) fetchUserProfileThrottled(p);
      }
    }
  }, [sorted, profiles, fetchUserProfileThrottled]);

  const getOtherParticipant = (participants: string[]): string | null => {
    if (!user) return participants[0] || null;
    return participants.find((p) => p !== user.pubkey) || participants[0] || null;
  };

  const getProfileName = (pubkey: string): string => {
    const profile = profiles?.get(pubkey);
    if (!profile) {
      return nip19.npubEncode(pubkey).slice(0, 12) + "...";
    }
    return profile.display_name || profile.name || nip19.npubEncode(pubkey).slice(0, 12) + "...";
  };

  const getProfilePicture = (pubkey: string): string => {
    const profile = profiles?.get(pubkey);
    if (!profile) {
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
    <Box maxWidth={800} mx="auto" px={2} py={2}>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={2}
      >
        <Typography variant="h5">Messages</Typography>
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
        <List disablePadding>
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
                  borderRadius: 2,
                  mb: 0.5,
                  "&:hover": {
                    backgroundColor: "action.hover",
                  },
                }}
              >
                <ListItemAvatar>
                  <Badge
                    badgeContent={conv.unreadCount}
                    color="primary"
                    invisible={conv.unreadCount === 0}
                  >
                    <Avatar src={getProfilePicture(otherPubkey)} />
                  </Badge>
                </ListItemAvatar>
                <ListItemText
                  primary={
                    <Typography variant="subtitle2">
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
