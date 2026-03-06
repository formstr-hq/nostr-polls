import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  Button,
  Stack,
  Collapse,
  Typography,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
  LinearProgress,
} from "@mui/material";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import { useNotification } from "../../contexts/notification-context";
import { useUserContext } from "../../hooks/useUserContext";
import { useNavigate } from "react-router-dom";
import { NOTIFICATION_MESSAGES } from "../../constants/notifications";
import { NOSTR_EVENT_KINDS } from "../../constants/nostr";
import { signEvent } from "../../nostr";
import { useRelays } from "../../hooks/useRelays";
import { Event } from "nostr-tools";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import { NotePreview } from "./NotePreview";
import { waitForPublish } from "../../utils/publish";
import MentionTextArea, { extractMentionTags } from "./MentionTextArea";
import { PostEnhancementDialog } from "./PostEnhancementDialog";
import { aiService } from "../../services/ai-service";
import { useAppContext } from "../../hooks/useAppContext";
import { uploadToBlossom, getBlossomServer } from "../../services/blossomService";

const UPLOAD_PLACEHOLDER = "[uploading…]";

const NoteTemplateForm: React.FC<{
  eventContent: string;
  setEventContent: (val: string) => void;
}> = ({ eventContent, setEventContent }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [topics, setTopics] = useState<string[]>([]);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [showEnhancementDialog, setShowEnhancementDialog] = useState(false);
  const [enhancementSuggestions, setEnhancementSuggestions] = useState<any>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Ref so async upload callbacks always see the latest content value
  const eventContentRef = useRef(eventContent);
  useEffect(() => { eventContentRef.current = eventContent; }, [eventContent]);
  const { showNotification } = useNotification();
  const { user } = useUserContext();
  const { relays } = useRelays();
  const { aiSettings } = useAppContext();
  const navigate = useNavigate();

  // Extract hashtags like #example from the text
  const extractHashtags = (text: string): string[] => {
    const hashtagRegex = /#(\w+)/g;
    const matches = text.matchAll(hashtagRegex);
    return Array.from(new Set(Array.from(matches, (m) => m[1].toLowerCase())));
  };

  // Update topics whenever eventContent changes
  useEffect(() => {
    setTopics(extractHashtags(eventContent));
  }, [eventContent]);

  const previewEvent: Partial<Event> = {
    content: eventContent,
    tags: topics.map((tag) => ["t", tag]),
  };

  // Insert text at a specific cursor position (or append if pos is at end)
  const insertAtPosition = (text: string, insertion: string, pos: number): string => {
    const before = text.slice(0, pos);
    const after = text.slice(pos);
    const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    const suffix = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
    return `${before}${prefix}${insertion}${suffix}${after}`;
  };

  const uploadFile = async (file: File, cursorPos?: number) => {
    if (!user) {
      showNotification("Please log in to upload files", "warning");
      return;
    }
    // Insert placeholder so the user sees upload is happening
    const insertPos = cursorPos ?? eventContentRef.current.length;
    setEventContent(insertAtPosition(eventContentRef.current, UPLOAD_PLACEHOLDER, insertPos));
    setIsUploading(true);
    try {
      const url = await uploadToBlossom(
        file,
        getBlossomServer(),
        (template) => signEvent(template, user.privateKey)
      );
      setEventContent(eventContentRef.current.replace(UPLOAD_PLACEHOLDER, url));
    } catch (err) {
      setEventContent(eventContentRef.current.replace(UPLOAD_PLACEHOLDER, ""));
      showNotification(
        err instanceof Error ? err.message : "Upload failed",
        "error"
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    // Reset so the same file can be re-selected
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = Array.from(e.dataTransfer.files).find(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
    );
    if (file) uploadFile(file);
  };

  const publishNoteEvent = async (secret?: string) => {
    try {
      if (!eventContent.trim()) {
        showNotification(NOTIFICATION_MESSAGES.EMPTY_NOTE_CONTENT, "error");
        return;
      }
      const mentionTags = extractMentionTags(eventContent);
      const noteEvent = {
        kind: NOSTR_EVENT_KINDS.TEXT_NOTE,
        content: eventContent,
        tags: [
          ...relays.map((relay) => ["relay", relay]),
          ...topics.map((tag) => ["t", tag]),
          ...mentionTags,
        ],
        created_at: Math.floor(Date.now() / 1000),
      };
      setIsSubmitting(true);
      const signedEvent = await signEvent(noteEvent, user?.privateKey);
      if (!signedEvent) {
        setIsSubmitting(false);
        showNotification(NOTIFICATION_MESSAGES.NOTE_SIGN_FAILED, "error");
        return;
      }
      const result = await waitForPublish(relays, signedEvent);
      setIsSubmitting(false);
      if (result.ok) {
        showNotification(
          NOTIFICATION_MESSAGES.NOTE_PUBLISHED_SUCCESS,
          "success"
        );
        navigate("/feeds/notes");
      } else {
        showNotification(
          NOTIFICATION_MESSAGES.NOTE_PUBLISH_NO_RELAY,
          "error"
        );
      }
    } catch (error) {
      setIsSubmitting(false);
      console.error("Error publishing note:", error);
      showNotification(NOTIFICATION_MESSAGES.NOTE_PUBLISH_FAILED, "error");
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    publishNoteEvent(user?.privateKey);
  };

  const handleProofread = async () => {
    if (!eventContent.trim()) {
      showNotification("Please write some content first", "info");
      return;
    }

    setIsEnhancing(true);
    try {
      const result = await aiService.enhancePost({
        model: aiSettings.model!,
        text: eventContent,
      });

      if (result.success && result.data) {
        setEnhancementSuggestions(result.data);
        setShowEnhancementDialog(true);
      } else {
        showNotification(
          result.error || "Failed to proofread",
          "error"
        );
      }
    } catch (error) {
      console.error("Proofread error:", error);
      showNotification("Failed to proofread post", "error");
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleApplySuggestions = (newText: string, hashtags: string[]) => {
    setEventContent(newText);
    setShowEnhancementDialog(false);
    showNotification("Suggestions applied!", "success");
  };

  return (
    <form onSubmit={handleSubmit}>
      <Stack spacing={4}>
        <Box>
          {/* Toolbar: attach file */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}>
            <Tooltip title="Attach image or video (Blossom)">
              <span>
                <IconButton
                  size="small"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading || isSubmitting}
                >
                  {isUploading ? (
                    <CircularProgress size={18} />
                  ) : (
                    <AttachFileIcon fontSize="small" />
                  )}
                </IconButton>
              </span>
            </Tooltip>
            <Typography variant="caption" color="text.secondary">
              Paste or drag &amp; drop images/videos to attach
            </Typography>
          </Box>

          {/* Upload progress bar */}
          {isUploading && <LinearProgress sx={{ mb: 0.5, borderRadius: 1 }} />}

          {/* Drag-and-drop zone wrapping the textarea */}
          <Box
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            sx={{
              position: "relative",
              outline: isDragOver ? "2px dashed" : "none",
              outlineColor: "primary.main",
              borderRadius: 1,
            }}
          >
            <MentionTextArea
              label="Note Content"
              value={eventContent}
              onChange={setEventContent}
              required
              placeholder="Share your thoughts. Use @mentions and #hashtags."
              onFilePaste={(file, cursorPos) => uploadFile(file, cursorPos)}
            />
            {isDragOver && (
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: "action.hover",
                  borderRadius: 1,
                  pointerEvents: "none",
                }}
              >
                <Typography variant="body2" color="primary">
                  Drop to upload
                </Typography>
              </Box>
            )}
          </Box>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />
        </Box>

        {topics.length > 0 && (
          <Box>
            <Typography variant="subtitle1" gutterBottom>
              Topics
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {topics.map((topic, index) => (
                <Chip
                  key={index}
                  label={`#${topic}`}
                  color="secondary"
                  variant="outlined"
                />
              ))}
            </Stack>
          </Box>
        )}

        <Box sx={{ pt: 2 }}>
          <Box display="flex" flexDirection="column" gap={2}>
            {aiSettings.model && (
              <Button
                variant="contained"
                color="secondary"
                startIcon={
                  isEnhancing ? (
                    <CircularProgress size={20} />
                  ) : (
                    <AutoFixHighIcon />
                  )
                }
                onClick={(e) => {
                  e.preventDefault();
                  handleProofread();
                }}
                disabled={isEnhancing || isSubmitting}
                fullWidth
                sx={{
                  bgcolor: 'secondary.main',
                  color: 'secondary.contrastText',
                  '&:hover': {
                    bgcolor: 'secondary.dark',
                  },
                }}
              >
                {isEnhancing ? "Proofreading..." : "Proofread with AI"}
              </Button>
            )}

            <Button type="submit" variant="contained" disabled={isSubmitting}>
              {isSubmitting ? "Creating Note..." : "Create Note"}
            </Button>

            <Button
              variant="outlined"
              startIcon={
                showPreview ? <VisibilityOffIcon /> : <VisibilityIcon />
              }
              onClick={(e) => {
                e.preventDefault();
                setShowPreview(!showPreview);
              }}
              fullWidth
            >
              {showPreview ? "Hide Preview" : "Show Preview"}
            </Button>

            <Collapse in={showPreview}>
              <Box mt={1}>
                <NotePreview noteEvent={previewEvent} />
              </Box>
            </Collapse>
          </Box>
        </Box>
      </Stack>

      <PostEnhancementDialog
        open={showEnhancementDialog}
        onClose={() => setShowEnhancementDialog(false)}
        suggestions={enhancementSuggestions}
        originalText={eventContent}
        onApply={handleApplySuggestions}
      />
    </form>
  );
};

export default NoteTemplateForm;
