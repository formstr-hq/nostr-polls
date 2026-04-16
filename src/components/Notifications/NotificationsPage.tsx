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
  Dialog,
  DialogTitle,
  DialogContent,
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
  const { notifications, markAllAsRead, refresh, pollMap } = useNostrNotifications();
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const { relays } = useRelays();
  const navigate = useNavigate();

  const [postSnippets, setPostSnippets] = useState<Map<string, string>>(new Map());
  const [rawJsonEvent, setRawJsonEvent] = useState<Event | null>(null);
  // fetchingRef: in-progress fetches; resolvedRef: already-fetched ids.
  // Both are stable refs so resolvePostContent never needs to close over state.
  const fetchingRef = useRef<Set<string>>(new Set());
  const resolvedRef = useRef<Set<string>>(new Set());

  // Catch up on missed events and mark all as read when the page mounts
  useEffect(() => {
    refresh();
    markAllAsRead();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resolvePostContent = useCallback(
    (postId: string, relayHint?: string) => {
      // Both checks use stable refs so this callback never needs to close over
      // postSnippets state — avoiding the circular recreation cascade.
      if (resolvedRef.current.has(postId) || fetchingRef.current.has(postId)) return;
      fetchingRef.current.add(postId);

      const cached = nostrRuntime.get(postId);
      if (cached) {
        resolvedRef.current.add(postId);
        setPostSnippets((prev) => {
          const next = new Map(prev);
          next.set(postId, cached.content?.slice(0, 80) || "");
          return next;
        });
        fetchingRef.current.delete(postId);
        return;
      }

      const fetchRelays = relayHint
        ? Array.from(new Set([...relays, relayHint]))
        : relays;
      nostrRuntime.fetchBatched(fetchRelays, postId).then((event) => {
        if (event) {
          resolvedRef.current.add(postId);
          setPostSnippets((prev) => {
            const next = new Map(prev);
            next.set(postId, event.content?.slice(0, 80) || "");
            return next;
          });
        }
        fetchingRef.current.delete(postId);
      });
    },
    [relays] // postSnippets intentionally removed — guard now uses stable resolvedRef
  );

  useEffect(() => {
    notifications.forEach((ev) => {
      const parsed = parseNotification(ev);
      if ((parsed.type === "reaction" || parsed.type === "zap" || parsed.type === "repost" || parsed.type === "highlight") && parsed.postId) {
        const relayHint = ev.tags.find(t => t[0] === 'e' && t[1] === parsed.postId)?.[2];
        resolvePostContent(parsed.postId, relayHint);
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
      case "comment": {
        const commentTitle =
          ev.kind === 1068 ? `${name} mentioned you in a poll` :
          ev.kind === 30023 ? `${name} mentioned you in an article` :
          `${name} commented`;
        return {
          title: commentTitle,
          body: parsed.content ? `"${parsed.content.slice(0, 80)}"` : "",
        };
      }
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
      case "repost":
        return {
          title: `${name} reposted you`,
          body: parsed.postId ? getPostSnippet(parsed.postId) : "",
        };
      case "highlight":
        return {
          title: `${name} highlighted your post`,
          body: parsed.content ? `"${parsed.content.slice(0, 80)}"` : "",
        };
      default:
        return { title: `Unknown event type (kind ${ev.kind})`, body: ev.content?.slice(0, 80) || "" };
    }
  };

  const handleItemClick = (ev: Event) => {
    const parsed = parseNotification(ev);

    if (parsed.type === "poll-response" && parsed.pollId) {
      navigate(`/respond/${nip19.neventEncode({ id: parsed.pollId })}`);
      return;
    }
    // For comments, navigate to the comment event itself — it's already in the
    // EventStore since it was fetched as a notification, so PrepareNote finds it immediately.
    if (parsed.type === "comment") {
      navigate(`/note/${nip19.neventEncode({ id: ev.id })}`);
      return;
    }
    if (parsed.postId) {
      // Pass relay hint from the "e" tag so PrepareNote can find the event even
      // if it isn't on the user's default relays.
      const eTag = ev.tags.find(t => t[0] === 'e' && t[1] === parsed.postId);
      const relayHint = eTag?.[2];
      navigate(`/note/${nip19.neventEncode({
        id: parsed.postId,
        ...(relayHint ? { relays: [relayHint] } : {}),
      })}`);
      return;
    }
    if (parsed.type === "unknown") {
      setRawJsonEvent(ev);
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
      <Dialog open={Boolean(rawJsonEvent)} onClose={() => setRawJsonEvent(null)} maxWidth="md" fullWidth>
        <DialogTitle>Raw event (kind {rawJsonEvent?.kind})</DialogTitle>
        <DialogContent>
          <Box
            component="pre"
            sx={{ m: 0, fontSize: "0.72rem", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}
          >
            {rawJsonEvent ? JSON.stringify(rawJsonEvent, null, 2) : ""}
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default NotificationsPage;
