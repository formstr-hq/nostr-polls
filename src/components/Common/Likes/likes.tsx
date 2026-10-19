import React, { useEffect, useRef, useState } from "react";
import {
  Tooltip,
  Box,
  IconButton,
  useTheme,
  Modal,
  Popover,
  Button,
  Divider,
} from "@mui/material";
import FavoriteBorder from "@mui/icons-material/FavoriteBorder";
import AddReactionOutlined from "@mui/icons-material/AddReactionOutlined";
import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";
import { useAppContext } from "../../../hooks/useAppContext";
import { Event, EventTemplate } from "nostr-tools/lib/types/core";
import { signEvent } from "../../../nostr";
import { useRelays } from "../../../hooks/useRelays";
import { useUserContext } from "../../../hooks/useUserContext";
import { dataLayer } from "@formstr/local-relay";
import ReactionsDetailsModal from "./ReactionsDetailsModal";
import {
  QUICK_REACTIONS,
  buildReactionTemplate,
  displayReaction,
} from "../../../utils/reactions";

const LONG_PRESS_MS = 500;

interface LikesProps {
  pollEvent: Event;
}

// Renders an emoji, supporting custom emoji shortcodes like :name:
const RenderEmoji: React.FC<{ content: string; tags?: string[][] }> = ({ content, tags }) => {
  // Check if it's a custom emoji shortcode pattern
  const match = content.match(/^:([a-zA-Z0-9_]+):$/);
  if (match && tags) {
    const shortcode = match[1];
    const emojiTag = tags.find(t => t[0] === "emoji" && t[1] === shortcode);
    if (emojiTag && emojiTag[2]) {
      return (
        <img
          src={emojiTag[2]}
          alt={`:${shortcode}:`}
          title={`:${shortcode}:`}
          style={{ height: "1.2em", width: "auto", verticalAlign: "middle" }}
        />
      );
    }
  }
  // Regular emoji or unresolved shortcode
  return <>{content}</>;
};

const Likes: React.FC<LikesProps> = ({ pollEvent }) => {
  const { likesMap, fetchLikesThrottled, addEventToMap, removeEventFromMap } = useAppContext();
  const { user, requestLogin } = useUserContext();
  const { relays } = useRelays();
  const [showPicker, setShowPicker] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [quickAnchor, setQuickAnchor] = useState<HTMLElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);
  const theme = useTheme();

  const reactions = likesMap?.get(pollEvent.id) || [];

  const startLongPress = () => {
    didLongPress.current = false;
    if (reactions.length === 0) return;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      setShowDetails(true);
    }, LONG_PRESS_MS);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleClick = () => {
    if (didLongPress.current) return;
    // Amethyst-style: one tap opens the compact quick-reaction row. The full
    // emoji picker is one more tap ("More reactions") from there.
    setQuickAnchor(buttonRef.current);
  };

  // All of the current user's own reactions on this note (a user can stack more
  // than one emoji). Used to highlight + toggle them off in the picker.
  const userReactions = user
    ? reactions.filter((r) => r.pubkey === user.pubkey)
    : [];

  const userReactionEvent = () => userReactions[0] || null;

  // Remove a reaction by publishing a NIP-09 deletion request (kind 5) for it,
  // then optimistically dropping it from the local view.
  const removeReaction = async (reactionEvent: Event) => {
    if (!user) {
      requestLogin();
      return;
    }
    const del: EventTemplate = {
      kind: 5,
      content: "",
      tags: [
        ["e", reactionEvent.id],
        ["k", "7"],
      ],
      created_at: Math.floor(Date.now() / 1000),
    };
    const signed = await signEvent(del, user.privateKey);
    if (signed) dataLayer.publishEvent(signed);
    removeEventFromMap(reactionEvent.id);
  };

  const addReaction = async (emoji: string) => {
    if (!user) {
      requestLogin();
      return;
    }

    // Tapping an emoji you've already reacted with toggles it off.
    const existing = userReactions.find(
      (r) => displayReaction(r.content) === displayReaction(emoji)
    );
    if (existing) {
      await removeReaction(existing);
      setShowPicker(false);
      return;
    }

    // NIP-25: `e` targets the event, `p` its author, `k` its kind, and `a` for
    // addressable targets. Built in one tested helper so reactions published
    // here are readable by Amethyst and other clients.
    const event = buildReactionTemplate(pollEvent, emoji, relays[0]);

    const finalEvent = await signEvent(event, user.privateKey);
    dataLayer.publishEvent(finalEvent!);
    addEventToMap(finalEvent!);
    setShowPicker(false);
  };

  /** React from the compact quick-reaction row and dismiss it. */
  const handleQuickReaction = async (emoji: string) => {
    setQuickAnchor(null);
    await addReaction(emoji);
  };

  useEffect(() => {
    if (!likesMap?.get(pollEvent.id)) {
      fetchLikesThrottled(pollEvent.id);
    }
  }, [pollEvent.id, likesMap, fetchLikesThrottled, user]);

  // Compute top emojis + count, preserving tags for custom emoji rendering.
  // "+"/"-" are normalized so an Amethyst-style like clusters with ❤️.
  const getTopEmojis = () => {
    const emojiData: Record<string, { count: number; tags?: string[][] }> = {};
    reactions.forEach((r) => {
      const emoji = displayReaction(r.content);
      if (!emojiData[emoji]) {
        emojiData[emoji] = { count: 0, tags: r.tags };
      }
      emojiData[emoji].count += 1;
    });
    const sorted = Object.entries(emojiData)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([emoji, data]) => ({ emoji, count: data.count, tags: data.tags }));
    return sorted;
  };

  const topEmojis = getTopEmojis();
  const userReaction = userReactionEvent();

  const hasReactions = reactions.length > 0;
  const tooltipTitle = hasReactions
    ? userReaction
      ? "Tap to change · Hold to see reactions"
      : "Tap to react · Hold to see reactions"
    : userReaction
    ? "Change reaction"
    : "Tap to react";

  return (
    <Box
      display="flex"
      alignItems="center"
      position="relative"
      sx={{ p: 0 }}
    >
      <Tooltip title={tooltipTitle}>
        <Box
          display="flex"
          alignItems="center"
          sx={{ cursor: "pointer", userSelect: "none" }}
          onMouseDown={startLongPress}
          onMouseUp={cancelLongPress}
          onMouseLeave={cancelLongPress}
          onTouchStart={startLongPress}
          onTouchEnd={cancelLongPress}
          onTouchCancel={cancelLongPress}
          onContextMenu={(e) => {
            if (didLongPress.current) e.preventDefault();
          }}
          onClick={handleClick}
        >
          <IconButton
            ref={buttonRef}
            size="small"
            sx={{ p: 0 }}
            component="span"
            aria-label="React"
          >
            {userReaction ? (
              <RenderEmoji content={displayReaction(userReaction.content)} tags={userReaction.tags} />
            ) : (
              <FavoriteBorder sx={{ p: 0 }} />
            )}
          </IconButton>

          {/* Top 2 emojis next to button — clicking the cluster (incl. the
              "+x" badge) opens the reactions details modal instead of the
              quick-reaction row. stopPropagation keeps the parent's click
              (which opens the quick row) from also firing. Only rendered when
              there are reactions; an empty cluster would still carry its ml
              margin and widen the row gap. */}
          {hasReactions && (
          <Box
            display="flex"
            alignItems="center"
            ml={1}
            gap={0.5}
            onClick={(e) => {
              e.stopPropagation();
              setShowDetails(true);
            }}
            sx={{ cursor: "pointer" }}
          >
            {topEmojis.slice(0, 2).map((r) => (
              <span key={r.emoji} style={{ fontSize: 18 }}>
                <RenderEmoji content={r.emoji} tags={r.tags} />
              </span>
            ))}
            {topEmojis.length > 2 && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  backgroundColor: theme.palette.primary.main,
                  color: theme.palette.primary.contrastText,
                  fontSize: 12,
                }}
              >
                +{topEmojis.length - 2}
              </span>
            )}
          </Box>
          )}
        </Box>
      </Tooltip>

      {/* Amethyst-style quick reaction row. Tapping an emoji reacts (or removes
          that same reaction) immediately; "More reactions" opens the full
          emoji picker. Published as a standard NIP-25 kind-7 event, so
          reactions made here show up in Amethyst and vice versa. */}
      <Popover
        open={Boolean(quickAnchor)}
        anchorEl={quickAnchor}
        onClose={() => setQuickAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        transformOrigin={{ vertical: "bottom", horizontal: "center" }}
        slotProps={{ paper: { sx: { p: 1, borderRadius: 3 } } }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
          {QUICK_REACTIONS.map((emoji) => {
            const mine = userReactions.some(
              (r) => displayReaction(r.content) === emoji
            );
            return (
              <Box
                key={emoji}
                role="button"
                tabIndex={0}
                aria-label={
                  mine ? `Remove ${emoji} reaction` : `React with ${emoji}`
                }
                aria-pressed={mine}
                onClick={() => void handleQuickReaction(emoji)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    void handleQuickReaction(emoji);
                  }
                }}
                sx={{
                  width: 40,
                  height: 40,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                  lineHeight: 1,
                  borderRadius: 2,
                  cursor: "pointer",
                  userSelect: "none",
                  border: 2,
                  borderColor: mine ? "primary.main" : "transparent",
                  bgcolor: mine ? "action.selected" : "transparent",
                  "&:hover": { bgcolor: "action.hover" },
                  "&:focus-visible": {
                    outline: "2px solid",
                    outlineColor: "primary.main",
                  },
                }}
              >
                {emoji}
              </Box>
            );
          })}
        </Box>
        <Divider sx={{ my: 0.75 }} />
        <Button
          size="small"
          fullWidth
          startIcon={<AddReactionOutlined />}
          onClick={() => {
            setQuickAnchor(null);
            setShowPicker(true);
          }}
          sx={{ justifyContent: "flex-start", textTransform: "none" }}
        >
          More reactions
        </Button>
      </Popover>

      {/* Emoji picker modal */}
      <Modal
        open={showPicker}
        onClose={() => setShowPicker(false)}
      >
        <Box
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          sx={{
            position: "absolute" as const,
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            bgcolor: "background.paper",
            boxShadow: 24,
            p: 2,
            borderRadius: 2,
            overscrollBehavior: "contain",
            touchAction: "pan-y",
          }}
        >
          {/* Your current reactions: highlighted chips you can tap to remove. */}
          {userReactions.length > 0 && (
            <Box sx={{ mb: 1.5 }}>
              <Box sx={{ fontSize: 12, color: "text.secondary", mb: 0.5 }}>
                Your reactions · tap to remove
              </Box>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                {userReactions.map((r) => (
                  <Box
                    key={r.id}
                    role="button"
                    aria-label={`Remove reaction ${r.content}`}
                    onClick={() => removeReaction(r)}
                    sx={{
                      display: "inline-flex",
                      alignItems: "center",
                      fontSize: 18,
                      lineHeight: 1,
                      px: 1,
                      py: 0.5,
                      borderRadius: 2,
                      cursor: "pointer",
                      border: 2,
                      borderColor: "primary.main",
                      bgcolor: "action.selected",
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  >
                    <RenderEmoji content={r.content} tags={r.tags} />
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          <EmojiPicker
            // Device-font emojis — no CDN sprite fetch, instant open, offline-safe.
            emojiStyle={EmojiStyle.NATIVE}
            lazyLoadEmojis={false}
            theme={
              theme.palette.mode === "light"
                ? ("light" as Theme)
                : ("dark" as Theme)
            }
            onEmojiClick={(emojiData) => addReaction(emojiData.emoji)}
          />
        </Box>
      </Modal>

      <ReactionsDetailsModal
        open={showDetails}
        onClose={() => setShowDetails(false)}
        reactions={reactions}
      />
    </Box>
  );
};

export default Likes;
