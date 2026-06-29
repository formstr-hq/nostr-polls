import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  AvatarGroup,
  Divider,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  Skeleton,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useNavigate } from "react-router-dom";
import { Event, nip19 } from "nostr-tools";
import { useNostrNotifications } from "../../contexts/nostr-notification-context";
import { parseNotification } from "../Header/notification-utils";
import { useAppContext } from "../../hooks/useAppContext";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";
import { dataLayer } from "@formstr/local-relay";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

const NotificationsPage: React.FC = () => {
  const { notifications, markAllAsRead, refresh, pollMap, isLoading } = useNostrNotifications();
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const navigate = useNavigate();

  const [postSnippets, setPostSnippets] = useState<Map<string, string>>(new Map());
  const [rawJsonEvent, setRawJsonEvent] = useState<Event | null>(null);
  const fetchingRef = useRef<Set<string>>(new Set());
  const fetchedRef = useRef<Set<string>>(new Set());

  // Catch up on missed events and mark all as read when the page mounts
  useEffect(() => {
    refresh();
    markAllAsRead();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resolvePostContent = useCallback(
    (postId: string, relayHint?: string) => {
      if (fetchedRef.current.has(postId) || fetchingRef.current.has(postId)) return;
      fetchingRef.current.add(postId);

      // fetchById reads the worker's store first (cache), then lets the worker
      // warm from the network — so there's no separate synchronous cache path.
      dataLayer.fetchById(postId).then((event) => {
        fetchedRef.current.add(postId);
        fetchingRef.current.delete(postId);
        if (event) {
          setPostSnippets((prev) => {
            const next = new Map(prev);
            next.set(postId, event.content?.slice(0, 80) || "");
            return next;
          });
        }
      });
    },
    []
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

  type NotifRow =
    | { kind: "single"; event: Event; ts: number }
    | { kind: "group"; groupType: "poll" | "reaction"; targetId: string; events: Event[]; ts: number };

  const rows: NotifRow[] = React.useMemo(() => {
    const events = Array.from(notifications.values()).sort(
      (a, b) => b.created_at - a.created_at
    );
    const polls = new Map<string, Event[]>();
    const reactions = new Map<string, Event[]>();
    const singles: Event[] = [];

    for (const ev of events) {
      if (ev.kind === 1018) {
        const pollId = ev.tags.find((t) => t[0] === "e")?.[1];
        if (pollId) {
          const list = polls.get(pollId);
          if (list) list.push(ev);
          else polls.set(pollId, [ev]);
          continue;
        }
      }
      if (ev.kind === 7) {
        const postId = parseNotification(ev).postId;
        if (postId) {
          const list = reactions.get(postId);
          if (list) list.push(ev);
          else reactions.set(postId, [ev]);
          continue;
        }
      }
      singles.push(ev);
    }

    const all: NotifRow[] = [];
    for (const ev of singles) all.push({ kind: "single", event: ev, ts: ev.created_at });
    Array.from(polls.entries()).forEach(([pollId, evs]) => {
      if (evs.length === 1) all.push({ kind: "single", event: evs[0], ts: evs[0].created_at });
      else all.push({ kind: "group", groupType: "poll", targetId: pollId, events: evs, ts: evs[0].created_at });
    });
    Array.from(reactions.entries()).forEach(([postId, evs]) => {
      if (evs.length === 1) all.push({ kind: "single", event: evs[0], ts: evs[0].created_at });
      else all.push({ kind: "group", groupType: "reaction", targetId: postId, events: evs, ts: evs[0].created_at });
    });
    all.sort((a, b) => b.ts - a.ts);
    return all;
  }, [notifications]);

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

  // Map a poll response (kind 1018) to the human-readable labels it selected,
  // resolving each `["response", optionId]` tag against the poll's
  // `["option", optionId, label]` tags. Falls back to the raw id if the poll
  // (or that option) isn't available yet.
  const getPollAnswer = (ev: Event, pollId: string | undefined): string => {
    const selected = ev.tags
      .filter((t) => t[0] === "response")
      .map((t) => t[1]);
    if (selected.length === 0) return "";
    const poll = pollId ? pollMap.get(pollId) : undefined;
    const labels = selected.map((id) => {
      const opt = poll?.tags.find((t) => t[0] === "option" && t[1] === id);
      return opt?.[2] || id.slice(0, 8);
    });
    return labels.join(", ");
  };

  const getNotifText = (ev: Event): { title: string; body: string } => {
    const parsed = parseNotification(ev);
    const name = getName(parsed.fromPubkey);

    switch (parsed.type) {
      case "poll-response": {
        const answer = getPollAnswer(ev, parsed.pollId);
        const question = pollMap.get(parsed.pollId!)?.content;
        const body = [
          answer ? `Chose: ${answer}` : "",
          question ? `"${question.slice(0, 80)}"` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return {
          title: `${name} responded to your poll`,
          body,
        };
      }
      case "comment": {
        const commentTitle =
          ev.kind === 1068 ? `${name} mentioned you in a poll` :
          ev.kind === 30023 ? `${name} mentioned you in an article` :
          parsed.rootKind === 1068 ? `${name} commented on your poll` :
          parsed.rootKind === 30023 ? `${name} commented on your article` :
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

  const getNotifActionText = (ev: Event): string | null => {
    const parsed = parseNotification(ev);
    if (!parsed.fromPubkey) return null;

    switch (parsed.type) {
      case "poll-response":
        return "responded to your poll";
      case "comment":
        return ev.kind === 1068
          ? "mentioned you in a poll"
          : ev.kind === 30023
            ? "mentioned you in an article"
            : parsed.rootKind === 1068
              ? "commented on your poll"
              : parsed.rootKind === 30023
                ? "commented on your article"
                : "commented";
      case "reaction":
        return `reacted ${parsed.reaction}`;
      case "zap":
        return "zapped you ⚡";
      case "repost":
        return "reposted you";
      case "highlight":
        return "highlighted your post";
      default:
        return null;
    }
  };

  const handleProfileClick = (
    e: React.MouseEvent | React.KeyboardEvent,
    pubkey: string | null
  ) => {
    if (!pubkey) return;
    e.stopPropagation();
    navigate(`/profile/${nip19.npubEncode(pubkey)}`);
  };

  const handleGroupClick = (groupType: "poll" | "reaction", targetId: string, events: Event[]) => {
    if (groupType === "poll") {
      navigate(`/respond/${nip19.neventEncode({ id: targetId })}`);
      return;
    }
    // Reaction group → navigate to the post, including a relay hint if any of the
    // reaction events carried one.
    const relayHint = events
      .map((ev) => ev.tags.find((t) => t[0] === "e" && t[1] === targetId)?.[2])
      .find((hint): hint is string => !!hint);
    navigate(`/note/${nip19.neventEncode({
      id: targetId,
      ...(relayHint ? { relays: [relayHint] } : {}),
    })}`);
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
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", overflowX: "hidden" }}>
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
      <Box sx={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {rows.length === 0 && isLoading ? (
          <List disablePadding>
            {Array.from({ length: 6 }).map((_, i) => (
              <React.Fragment key={i}>
                <ListItem alignItems="flex-start">
                  <ListItemAvatar>
                    <Skeleton variant="circular" width={40} height={40} />
                  </ListItemAvatar>
                  <ListItemText
                    primary={<Skeleton variant="text" width="60%" />}
                    secondary={
                      <>
                        <Skeleton variant="text" width="85%" />
                        <Skeleton variant="text" width="30%" />
                      </>
                    }
                  />
                </ListItem>
                <Divider component="li" />
              </React.Fragment>
            ))}
          </List>
        ) : rows.length === 0 ? (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}>
            <Typography variant="body2" color="text.secondary">
              No notifications yet
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            {rows.map((row) => {
              if (row.kind === "group") {
                const ts = dayjs.unix(row.ts).fromNow();
                const count = row.events.length;
                // Distinct pubkeys, latest first (events are sorted desc).
                const uniquePubkeys: string[] = [];
                for (const ev of row.events) {
                  if (!uniquePubkeys.includes(ev.pubkey)) uniquePubkeys.push(ev.pubkey);
                  if (uniquePubkeys.length >= 5) break;
                }
                const title = row.groupType === "poll"
                  ? `${count} new poll responses`
                  : `${count} new reactions to your post`;
                const bodyText = row.groupType === "poll"
                  ? (pollMap.get(row.targetId)?.content
                      ? `"${pollMap.get(row.targetId)!.content.slice(0, 80)}"`
                      : "")
                  : getPostSnippet(row.targetId);

                return (
                  <React.Fragment key={`${row.groupType}:${row.targetId}`}>
                    <ListItem
                      alignItems="flex-start"
                      onClick={() => handleGroupClick(row.groupType, row.targetId, row.events)}
                      sx={{ cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
                    >
                      <ListItemAvatar>
                        <AvatarGroup
                          max={3}
                          spacing="small"
                          sx={{ "& .MuiAvatar-root": { width: 32, height: 32, fontSize: "0.75rem" } }}
                        >
                          {uniquePubkeys.map((pk) => (
                            <Avatar key={pk} src={getAvatar(pk)} alt={getName(pk)} />
                          ))}
                        </AvatarGroup>
                      </ListItemAvatar>
                      <ListItemText
                        primary={<Typography variant="subtitle2">{title}</Typography>}
                        secondary={
                          <>
                            {bodyText && (
                              <Typography
                                component="span"
                                variant="body2"
                                color="text.secondary"
                                display="block"
                              >
                                {bodyText}
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
              }

              const ev = row.event;
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
                      <Avatar
                        src={getAvatar(parsed.fromPubkey)}
                        onClick={(e) => handleProfileClick(e, parsed.fromPubkey)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleProfileClick(e, parsed.fromPubkey);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        sx={{ cursor: parsed.fromPubkey ? "pointer" : "default" }}
                      />
                    </ListItemAvatar>
                    <ListItemText
                      primary={
                        getNotifActionText(ev) && parsed.fromPubkey ? (
                          <Typography variant="subtitle2" sx={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
                            <Box
                              component="span"
                              onClick={(e) => handleProfileClick(e, parsed.fromPubkey)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  handleProfileClick(e, parsed.fromPubkey);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              sx={{
                                cursor: "pointer",
                                fontWeight: 600,
                                "&:hover, &:focus-visible": {
                                  textDecoration: "underline",
                                },
                              }}
                            >
                              {getName(parsed.fromPubkey)}
                            </Box>{" "}
                            {getNotifActionText(ev)}
                          </Typography>
                        ) : (
                          <Typography variant="subtitle2" sx={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>{title}</Typography>
                        )
                      }
                      secondary={
                        <>
                          {body && (
                            <Typography
                              component="span"
                              variant="body2"
                              color="text.secondary"
                              display="block"
                              sx={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
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
