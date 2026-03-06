import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Divider,
  IconButton,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useNavigate } from "react-router-dom";
import { Event, nip19 } from "nostr-tools";
import { useNostrNotifications } from "../../contexts/nostr-notification-context";
import { parseNotification } from "../Header/notification-utils";
import { useAppContext } from "../../hooks/useAppContext";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";
import { nostrRuntime } from "../../singletons";
import { useRelays } from "../../hooks/useRelays";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

const NotificationsPage: React.FC = () => {
  const { notifications, markAllAsRead, pollMap } = useNostrNotifications();
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const { relays } = useRelays();
  const navigate = useNavigate();

  const [postSnippets, setPostSnippets] = useState<Map<string, string>>(new Map());
  const fetchingRef = useRef<Set<string>>(new Set());

  // Mark all as read when the page mounts
  useEffect(() => {
    markAllAsRead();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resolvePostContent = useCallback(
    (postId: string) => {
      if (postSnippets.has(postId) || fetchingRef.current.has(postId)) return;
      fetchingRef.current.add(postId);

      const cached = nostrRuntime.get(postId);
      if (cached) {
        setPostSnippets((prev) => {
          const next = new Map(prev);
          next.set(postId, cached.content?.slice(0, 80) || "");
          return next;
        });
        fetchingRef.current.delete(postId);
        return;
      }

      nostrRuntime.fetchBatched(relays, postId).then((event) => {
        if (event) {
          setPostSnippets((prev) => {
            const next = new Map(prev);
            next.set(postId, event.content?.slice(0, 80) || "");
            return next;
          });
        }
        fetchingRef.current.delete(postId);
      });
    },
    [relays, postSnippets]
  );

  useEffect(() => {
    notifications.forEach((ev) => {
      const parsed = parseNotification(ev);
      if ((parsed.type === "reaction" || parsed.type === "zap") && parsed.postId) {
        resolvePostContent(parsed.postId);
      }
    });
  }, [notifications, resolvePostContent]);

  const sorted = Array.from(notifications.values()).sort(
    (a, b) => b.created_at - a.created_at
  );

  const getName = (pubkey: string | null) => {
    if (!pubkey) return "Someone";
    if (!profiles?.get(pubkey)) fetchUserProfileThrottled(pubkey);
    const meta = profiles?.get(pubkey);
    return meta?.display_name || meta?.name || nip19.npubEncode(pubkey).slice(0, 8);
  };

  const getAvatar = (pubkey: string | null) => {
    if (!pubkey) return DEFAULT_IMAGE_URL;
    const meta = profiles?.get(pubkey);
    if (!meta) fetchUserProfileThrottled(pubkey);
    return meta?.picture || DEFAULT_IMAGE_URL;
  };

  const getPostSnippet = (postId: string | undefined) => {
    if (!postId) return "";
    const snippet = postSnippets.get(postId);
    if (snippet) {
      const display = snippet.length > 60 ? snippet.slice(0, 60) + "\u2026" : snippet;
      return `"${display}"`;
    }
    return `post ${postId.slice(0, 8)}\u2026`;
  };

  const getNotifText = (ev: Event): { title: string; body: string } => {
    const parsed = parseNotification(ev);
    const name = getName(parsed.fromPubkey);

    switch (parsed.type) {
      case "poll-response":
        return {
          title: `${name} responded to your poll`,
          body: pollMap.get(parsed.pollId!)?.content
            ? `"${pollMap.get(parsed.pollId!)?.content.slice(0, 80)}"`
            : "",
        };
      case "comment":
        return {
          title: `${name} commented`,
          body: parsed.content ? `"${parsed.content.slice(0, 80)}"` : "",
        };
      case "reaction":
        return {
          title: `${name} reacted ${parsed.reaction}`,
          body: parsed.postId ? `To your post: ${getPostSnippet(parsed.postId)}` : "",
        };
      case "zap":
        return {
          title: `${name} zapped you \u26a1`,
          body: parsed.sats
            ? `${parsed.sats} sats${parsed.postId ? ` · ${getPostSnippet(parsed.postId)}` : ""}`
            : "",
        };
      default:
        return { title: "New activity", body: ev.content?.slice(0, 80) || "" };
    }
  };

  const handleItemClick = (ev: Event) => {
    const parsed = parseNotification(ev);

    if (parsed.type === "poll-response" && parsed.pollId) {
      navigate(`/respond/${nip19.neventEncode({ id: parsed.pollId })}`);
      return;
    }
    if (parsed.postId) {
      navigate(`/note/${nip19.neventEncode({ id: parsed.postId })}`);
      return;
    }
    if (parsed.fromPubkey) {
      navigate(`/profile/${nip19.npubEncode(parsed.fromPubkey)}`);
    }
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header bar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          px: 1,
          py: 1,
          borderBottom: "1px solid",
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <IconButton onClick={() => navigate(-1)} edge="start">
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h6" sx={{ ml: 1 }}>
          Notifications
        </Typography>
      </Box>

      {/* List */}
      <Box sx={{ flex: 1, overflowY: "auto" }}>
        {sorted.length === 0 ? (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}>
            <Typography variant="body2" color="text.secondary">
              No notifications yet
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            {sorted.map((ev) => {
              const { title, body } = getNotifText(ev);
              const parsed = parseNotification(ev);
              const ts = dayjs.unix(ev.created_at).fromNow();

              return (
                <React.Fragment key={ev.id}>
                  <ListItem
                    alignItems="flex-start"
                    onClick={() => handleItemClick(ev)}
                    sx={{ cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
                  >
                    <ListItemAvatar>
                      <Avatar src={getAvatar(parsed.fromPubkey)} />
                    </ListItemAvatar>
                    <ListItemText
                      primary={
                        <Typography variant="subtitle2">{title}</Typography>
                      }
                      secondary={
                        <>
                          {body && (
                            <Typography
                              component="span"
                              variant="body2"
                              color="text.secondary"
                              display="block"
                            >
                              {body}
                            </Typography>
                          )}
                          <Typography
                            component="span"
                            variant="caption"
                            color="text.disabled"
                          >
                            {ts}
                          </Typography>
                        </>
                      }
                    />
                  </ListItem>
                  <Divider component="li" />
                </React.Fragment>
              );
            })}
          </List>
        )}
      </Box>
    </Box>
  );
};

export default NotificationsPage;
