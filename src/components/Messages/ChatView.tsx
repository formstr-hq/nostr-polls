import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Typography,
  Avatar,
  IconButton,
  TextField,
  Modal,
  CircularProgress,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SendIcon from "@mui/icons-material/Send";
import ReplyIcon from "@mui/icons-material/Reply";
import CloseIcon from "@mui/icons-material/Close";
import { useNavigate, useParams } from "react-router-dom";
import { nip19 } from "nostr-tools";
import EmojiPicker, { Theme } from "emoji-picker-react";
import { useTheme } from "@mui/material/styles";
import { useDMContext } from "../../hooks/useDMContext";
import { useAppContext } from "../../hooks/useAppContext";
import { useUserContext } from "../../hooks/useUserContext";
import { getConversationId, fetchInboxRelays } from "../../nostr/nip17";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";
import { DMMessage } from "../../contexts/dm-context";
import MessageBubble from "./MessageBubble";
import MessageContextMenu from "./MessageContextMenu";

const ChatView: React.FC = () => {
  const { npub } = useParams<{ npub: string }>();
  const navigate = useNavigate();
  const { conversations, sendMessage, sendReaction, markAsRead } =
    useDMContext();
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const { user } = useUserContext();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [contextMenuMsg, setContextMenuMsg] = useState<DMMessage | null>(null);
  const [replyTo, setReplyTo] = useState<DMMessage | null>(null);
  const [pickerForMsgId, setPickerForMsgId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const theme = useTheme();

  // Decode npub to pubkey
  let recipientPubkey: string | null = null;
  try {
    if (npub) {
      const decoded = nip19.decode(npub);
      if (decoded.type === "npub") {
        recipientPubkey = decoded.data;
      } else if (decoded.type === "nprofile") {
        recipientPubkey = decoded.data.pubkey;
      }
    }
  } catch {
    // invalid npub
  }

  const conversationId =
    user && recipientPubkey
      ? getConversationId(user.pubkey, [recipientPubkey])
      : null;
  const conversation = conversationId
    ? conversations.get(conversationId)
    : null;

  useEffect(() => {
    if (recipientPubkey && !profiles?.get(recipientPubkey)) {
      fetchUserProfileThrottled(recipientPubkey);
    }
  }, [recipientPubkey, profiles, fetchUserProfileThrottled]);

  // Warm the inbox relay cache for both parties as soon as the chat opens,
  // so the relay lookup is already resolved by the time the user hits send.
  // persist=true only for the logged-in user — their relays are saved to localStorage.
  useEffect(() => {
    if (recipientPubkey && user?.pubkey) {
      fetchInboxRelays(recipientPubkey);
      fetchInboxRelays(user.pubkey, true);
    }
  }, [recipientPubkey, user?.pubkey]);

  useEffect(() => {
    if (conversationId && conversation && conversation.unreadCount > 0) {
      markAsRead(conversationId);
    }
  }, [conversationId, conversation, markAsRead]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages?.length]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !recipientPubkey || sending) return;
    const content = input.trim();
    setInput("");
    setSending(true);
    try {
      await sendMessage(recipientPubkey, content, replyTo?.id);
      setReplyTo(null);
    } catch (e) {
      console.error("Failed to send message:", e);
      setInput(content);
    } finally {
      setSending(false);
    }
  }, [input, recipientPubkey, sending, sendMessage, replyTo]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReaction = useCallback(
    async (emoji: string, messageId: string) => {
      if (!recipientPubkey) return;
      try {
        await sendReaction(recipientPubkey, emoji, messageId);
      } catch (e) {
        console.error("Failed to send reaction:", e);
      }
    },
    [recipientPubkey, sendReaction],
  );

  if (!recipientPubkey) {
    return (
      <Box maxWidth={800} mx="auto" px={2} py={4}>
        <Typography color="error">Invalid recipient</Typography>
      </Box>
    );
  }

  const recipientProfile = profiles?.get(recipientPubkey);
  const recipientName =
    recipientProfile?.display_name ||
    recipientProfile?.name ||
    nip19.npubEncode(recipientPubkey).slice(0, 12) + "...";
  const recipientPicture = recipientProfile?.picture || DEFAULT_IMAGE_URL;

  const messages = conversation?.messages || [];

  return (
    <Box
      maxWidth={800}
      mx="auto"
      display="flex"
      flexDirection="column"
      height="calc(100vh - 64px)"
    >
      {/* Top bar */}
      <Box
        display="flex"
        alignItems="center"
        gap={1}
        px={2}
        py={1}
        sx={{ borderBottom: 1, borderColor: "divider" }}
      >
        <IconButton onClick={() => navigate("/messages")} size="small">
          <ArrowBackIcon />
        </IconButton>
        <Avatar
          src={recipientPicture}
          sx={{ width: 36, height: 36, cursor: "pointer" }}
          onClick={() =>
            navigate(`/profile/${nip19.npubEncode(recipientPubkey!)}`)
          }
        />
        <Typography
          variant="subtitle1"
          sx={{ cursor: "pointer" }}
          onClick={() =>
            navigate(`/profile/${nip19.npubEncode(recipientPubkey!)}`)
          }
        >
          {recipientName}
        </Typography>
      </Box>

      {/* Messages area */}
      <Box
        flex={1}
        overflow="auto"
        px={2}
        py={1}
        display="flex"
        flexDirection="column"
        gap={1}
      >
        {messages.length === 0 && (
          <Box
            flex={1}
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <Typography variant="body2" color="text.secondary">
              No messages yet. Say hello!
            </Typography>
          </Box>
        )}
        {messages.map((msg) => {
          const isMine = msg.pubkey === user?.pubkey;
          const msgReactions = conversation?.reactions?.get(msg.id) || [];
          const groupedReactions = msgReactions.reduce<
            Record<
              string,
              { emoji: string; count: number; pubkeys: string[]; tags?: string[][] }
            >
          >((acc, r) => {
            if (!acc[r.emoji]) {
              acc[r.emoji] = { emoji: r.emoji, count: 0, pubkeys: [], tags: r.tags };
            }
            acc[r.emoji].count++;
            acc[r.emoji].pubkeys.push(r.pubkey);
            return acc;
          }, {});

          const replyTag = msg.tags.find(
            (t) => t[0] === "e" && t[3] === "reply"
          );
          const referencedMsg = replyTag
            ? messages.find((m) => m.id === replyTag[1])
            : undefined;
          const referencedMsgSenderName = referencedMsg
            ? referencedMsg.pubkey === user?.pubkey
              ? "You"
              : recipientName
            : undefined;

          return (
            <MessageBubble
              key={msg.id}
              msg={msg}
              isMine={isMine}
              reactions={groupedReactions}
              referencedMsg={referencedMsg}
              referencedMsgSenderName={referencedMsgSenderName}
              onLongPress={setContextMenuMsg}
              onReact={handleReaction}
              onSwipeReply={setReplyTo}
            />
          );
        })}
        <div ref={messagesEndRef} />
      </Box>

      {/* Reply preview bar */}
      {replyTo && (
        <Box
          display="flex"
          alignItems="center"
          gap={1}
          px={2}
          py={0.75}
          sx={{
            borderTop: 1,
            borderLeft: 3,
            borderColor: "primary.main",
            bgcolor: "action.hover",
          }}
        >
          <ReplyIcon fontSize="small" color="primary" />
          <Box flex={1} minWidth={0}>
            <Typography
              variant="caption"
              color="primary"
              fontWeight={600}
              display="block"
            >
              {replyTo.pubkey === user?.pubkey ? "You" : recipientName}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {replyTo.content}
            </Typography>
          </Box>
          <IconButton size="small" onClick={() => setReplyTo(null)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

      {/* Input area */}
      <Box
        display="flex"
        alignItems="center"
        gap={1}
        px={2}
        py={1.5}
        sx={{ borderTop: 1, borderColor: "divider" }}
      >
        <TextField
          fullWidth
          size="small"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          multiline
          maxRows={4}
          disabled={sending}
        />
        <IconButton
          color="primary"
          onClick={handleSend}
          disabled={!input.trim() || sending}
        >
          {sending ? (
            <CircularProgress size={20} color="inherit" />
          ) : (
            <SendIcon />
          )}
        </IconButton>
      </Box>

      {/* Context menu */}
      <MessageContextMenu
        msg={contextMenuMsg}
        onClose={() => setContextMenuMsg(null)}
        onReact={handleReaction}
        onReply={setReplyTo}
        onCopy={(content) => navigator.clipboard.writeText(content)}
        onOpenEmojiPicker={setPickerForMsgId}
      />

      {/* Full emoji picker — single instance, shared across all messages */}
      <Modal
        open={Boolean(pickerForMsgId)}
        onClose={() => setPickerForMsgId(null)}
      >
        <Box
          sx={{
            position: "absolute",
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
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          <EmojiPicker
            theme={
              theme.palette.mode === "light"
                ? ("light" as Theme)
                : ("dark" as Theme)
            }
            onEmojiClick={(emojiData) => {
              if (pickerForMsgId) handleReaction(emojiData.emoji, pickerForMsgId);
              setPickerForMsgId(null);
            }}
          />
        </Box>
      </Modal>
    </Box>
  );
};

export default ChatView;
