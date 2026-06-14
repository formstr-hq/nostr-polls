import React, { useState, useCallback, useRef } from "react";
import {
  Box,
  IconButton,
  TextField,
  Typography,
  CircularProgress,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import ReplyIcon from "@mui/icons-material/Reply";
import CloseIcon from "@mui/icons-material/Close";
import { DMMessage } from "../../contexts/dm-context";
import EmojiPickerButton from "../Common/EmojiPickerButton";

interface MessageInputProps {
  replyTo: DMMessage | null;
  replyToSenderName?: string;
  onClearReply: () => void;
  /** Called with trimmed content when user submits. Throw to signal failure (restores input). */
  onSend: (content: string) => Promise<void>;
}

const MessageInput: React.FC<MessageInputProps> = ({
  replyTo,
  replyToSenderName,
  onClearReply,
  onSend,
}) => {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const cursorRef = useRef<number>(0);

  const trackCursor = () => {
    if (inputRef.current) {
      cursorRef.current = inputRef.current.selectionStart ?? input.length;
    }
  };

  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      const pos = Math.min(cursorRef.current, input.length);
      const next = input.slice(0, pos) + emoji + input.slice(pos);
      setInput(next);
      const newPos = pos + emoji.length;
      cursorRef.current = newPos;
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(newPos, newPos);
        }
      });
    },
    [input]
  );

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return;
    const content = input.trim();
    setInput("");
    setSending(true);
    try {
      await onSend(content);
    } catch {
      setInput(content); // restore on failure
    } finally {
      setSending(false);
    }
  }, [input, sending, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Box>
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
              {replyToSenderName}
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
          <IconButton size="small" onClick={onClearReply}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

      {/* Text field + send button */}
      <Box
        display="flex"
        alignItems="center"
        gap={1}
        px={2}
        py={1.5}
        sx={{ borderTop: 1, borderColor: "divider" }}
      >
        <EmojiPickerButton
          onSelect={handleEmojiSelect}
          disabled={sending}
          placement="top-start"
        />
        <TextField
          fullWidth
          size="small"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            trackCursor();
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={trackCursor}
          onClick={trackCursor}
          onSelect={trackCursor}
          inputRef={inputRef}
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
    </Box>
  );
};

export default MessageInput;
