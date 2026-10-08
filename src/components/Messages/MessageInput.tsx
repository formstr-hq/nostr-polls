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
import AttachFileIcon from "@mui/icons-material/AttachFile";
import MicIcon from "@mui/icons-material/Mic";
import StopIcon from "@mui/icons-material/Stop";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { DMMessage } from "../../contexts/dm-context";
import EmojiPickerButton from "../Common/EmojiPickerButton";
import { useVoiceRecorder } from "./useVoiceRecorder";

interface MessageInputProps {
  replyTo: DMMessage | null;
  replyToSenderName?: string;
  onClearReply: () => void;
  /** Called with trimmed content when user submits. Throw to signal failure (restores input). */
  onSend: (content: string) => Promise<void>;
  /** Called with the picked/recorded file (+ voice extras) when it is sent.
   *  Throw to signal failure (keeps the selection so the user can retry). */
  onSendFile?: (
    file: File,
    extra?: { waveform?: number[]; duration?: number }
  ) => Promise<void>;
  /** Fired on keystrokes for typing indicators (throttled upstream). */
  onTyping?: () => void;
}

const MessageInput: React.FC<MessageInputProps> = ({
  replyTo,
  replyToSenderName,
  onClearReply,
  onSend,
  onSendFile,
  onTyping,
}) => {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const cursorRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Waveform/duration captured when a voice take is finalized; one-shot.
  const voiceExtraRef = useRef<{ waveform?: number[]; duration?: number } | null>(
    null
  );
  const recorder = useVoiceRecorder();

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
    if (sending || recorder.recording) return;
    if (selectedFile) {
      if (!onSendFile) return;
      setSending(true);
      try {
        await onSendFile(selectedFile, voiceExtraRef.current ?? undefined);
        setSelectedFile(null);
        voiceExtraRef.current = null;
      } catch {
        // keep the selection so the user can retry
      } finally {
        setSending(false);
      }
      return;
    }
    if (!input.trim()) return;
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
  }, [input, sending, onSend, selectedFile, onSendFile, recorder.recording]);

  /** Voice take finalized -> send it right away as an encrypted file. */
  const handleMicStop = useCallback(async () => {
    const take = await recorder.stop();
    if (!take || !onSendFile) return;
    const extension = take.mimeType.includes("mp4") ? "m4a" : "webm";
    const file = new File([take.blob], `voice-note.${extension}`, {
      type: take.mimeType,
    });
    voiceExtraRef.current = {
      waveform: take.waveform,
      duration: take.duration,
    };
    setSelectedFile(file);
    setSending(true);
    try {
      await onSendFile(file, voiceExtraRef.current);
      voiceExtraRef.current = null;
      setSelectedFile(null);
    } catch {
      // chip stays so the send button can retry it
    } finally {
      setSending(false);
    }
  }, [recorder, onSendFile]);

  const handleMicCancel = useCallback(async () => {
    await recorder.cancel();
  }, [recorder]);

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
              {replyTo.file ? "📎 " + (replyTo.file.fileName || "Attachment") : replyTo.content}
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClearReply}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

      {/* Attachment preview chip */}
      {selectedFile && (
        <Box
          display="flex"
          alignItems="center"
          gap={1}
          px={2}
          py={0.75}
          sx={{ borderTop: 1, borderColor: "divider", bgcolor: "action.hover" }}
        >
          <AttachFileIcon fontSize="small" color="primary" />
          <Box flex={1} minWidth={0}>
            <Typography
              variant="caption"
              display="block"
              sx={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {selectedFile.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {(selectedFile.size / 1024).toFixed(0)} KB
            </Typography>
          </Box>
          <IconButton
            size="small"
            onClick={() => {
              setSelectedFile(null);
              voiceExtraRef.current = null;
            }}
            disabled={sending}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

      {/* Text field + send button — or the recording bar while capturing */}
      <Box
        display="flex"
        alignItems="center"
        gap={1}
        px={2}
        py={1.5}
        sx={{ borderTop: 1, borderColor: "divider" }}
      >
        {recorder.recording ? (
          <>
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                bgcolor: "error.main",
                flexShrink: 0,
              }}
            />
            <Box flex={1} minWidth={0}>
              <Typography variant="body2" color="error.main" noWrap>
                Recording… {recorder.elapsed}s (max 60s)
              </Typography>
            </Box>
            <IconButton onClick={() => void handleMicCancel()}>
              <DeleteOutlineIcon />
            </IconButton>
            <IconButton color="primary" onClick={() => void handleMicStop()}>
              <StopIcon />
            </IconButton>
          </>
        ) : (
          <>
            <input
              type="file"
              hidden
              ref={fileInputRef}
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (f) setSelectedFile(f);
                e.target.value = "";
              }}
            />
            <IconButton
              size="small"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
            >
              <AttachFileIcon />
            </IconButton>
            <IconButton
              size="small"
              onClick={() => void recorder.start()}
              disabled={sending}
            >
              <MicIcon />
            </IconButton>
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
                onTyping?.();
              }}
              onKeyUp={trackCursor}
              onClick={trackCursor}
              onSelect={trackCursor}
              inputRef={inputRef}
              multiline
              maxRows={4}
              disabled={sending}
            />
          </>
        )}
        <IconButton
          color="primary"
          onClick={handleSend}
          disabled={
            (recorder.recording || (!input.trim() && !selectedFile)) || sending
          }
        >
          {sending ? (
            <CircularProgress size={20} color="inherit" />
          ) : (
            <SendIcon />
          )}
        </IconButton>
      </Box>
      {recorder.error && (
        <Typography
          variant="caption"
          color="error.main"
          sx={{ display: "block", px: 2, pb: 0.5 }}
        >
          {recorder.error}
        </Typography>
      )}
    </Box>
  );
};

export default MessageInput;
