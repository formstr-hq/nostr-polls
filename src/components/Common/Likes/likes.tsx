import React, { useEffect, useState } from "react";
import { Tooltip, Box, IconButton, useTheme, Modal } from "@mui/material";
import FavoriteBorder from "@mui/icons-material/FavoriteBorder";
import EmojiPicker, { Theme } from "emoji-picker-react";
import { useAppContext } from "../../../hooks/useAppContext";
import { Event, EventTemplate } from "nostr-tools/lib/types/core";
import { signEvent } from "../../../nostr";
import { useRelays } from "../../../hooks/useRelays";
import { useUserContext } from "../../../hooks/useUserContext";
import { useNotification } from "../../../contexts/notification-context";
import { NOTIFICATION_MESSAGES } from "../../../constants/notifications";
import { pool } from "../../../singletons";

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
  const { likesMap, fetchLikesThrottled, addEventToMap } = useAppContext();
  const { showNotification } = useNotification();
  const { user } = useUserContext();
  const { relays, writeRelays } = useRelays();
  const [showPicker, setShowPicker] = useState(false);
  const theme = useTheme();

  const userReactionEvent = () => {
    if (!user) return null;
    return likesMap?.get(pollEvent.id)?.find((r) => r.pubkey === user.pubkey) || null;
  };

  const addReaction = async (emoji: string) => {
    if (!user) {
      showNotification(NOTIFICATION_MESSAGES.LOGIN_TO_LIKE, "warning");
      return;
    }

    const event: EventTemplate = {
      content: emoji,
      kind: 7,
      tags: [["e", pollEvent.id, relays[0]]],
      created_at: Math.floor(Date.now() / 1000),
    };

    const finalEvent = await signEvent(event, user.privateKey);
    pool.publish(writeRelays, finalEvent!);
    addEventToMap(finalEvent!);
    setShowPicker(false);
  };

  useEffect(() => {
    if (!likesMap?.get(pollEvent.id)) {
      fetchLikesThrottled(pollEvent.id);
    }
  }, [pollEvent.id, likesMap, fetchLikesThrottled, user]);

  // Compute top emojis + count, preserving tags for custom emoji rendering
  const getTopEmojis = () => {
    const reactions = likesMap?.get(pollEvent.id) || [];
    const emojiData: Record<string, { count: number; tags?: string[][] }> = {};
    reactions.forEach((r) => {
      if (!emojiData[r.content]) {
        emojiData[r.content] = { count: 0, tags: r.tags };
      }
      emojiData[r.content].count += 1;
    });
    const sorted = Object.entries(emojiData)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([emoji, data]) => ({ emoji, count: data.count, tags: data.tags }));
    return sorted;
  };

  const topEmojis = getTopEmojis();
  const userReaction = userReactionEvent();

  return (
    <Box
      display="flex"
      alignItems="center"
      ml={2}
      position="relative"
      sx={{ p: 0, my: -5 }}
    >
      {/* Heart / User emoji */}
      <Tooltip
        title={userReaction ? "Change reaction" : "React"}
        onClick={() => setShowPicker(true)}
      >
        <IconButton size="small" sx={{ p: 0 }}>
          {userReaction ? (
            <RenderEmoji content={userReaction.content} tags={userReaction.tags} />
          ) : (
            <FavoriteBorder sx={{ p: 0 }} />
          )}
        </IconButton>
      </Tooltip>

      {/* Top 2 emojis next to button */}
      <Box display="flex" alignItems="center" ml={1} gap={0.5}>
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
          <EmojiPicker
            theme={
              theme.palette.mode === "light"
                ? ("light" as Theme)
                : ("dark" as Theme)
            }
            onEmojiClick={(emojiData) => addReaction(emojiData.emoji)}
          />
        </Box>
      </Modal>
    </Box>
  );
};

export default Likes;
