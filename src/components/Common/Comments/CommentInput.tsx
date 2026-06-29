import React, { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  LinearProgress,
  Tooltip,
  Typography,
} from "@mui/material";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import MentionTextArea, { extractMentionTags } from "../../EventCreator/MentionTextArea";
import { TextWithImages } from "../Parsers/TextWithImages";
import { useUserContext } from "../../../hooks/useUserContext";
import { useNotification } from "../../../contexts/notification-context";
import { signEvent } from "../../../nostr";
import { uploadToBlossom, getBlossomServer } from "../../../services/blossomService";

interface CommentInputProps {
  onSubmit: (content: string) => void;
  initialContent?: string;
}

const UPLOAD_PLACEHOLDER = "[uploading…]";

// Insert text at a cursor position, padding with newlines so a pasted media URL
// sits on its own line.
const insertAtPosition = (text: string, insertion: string, pos: number): string => {
  const before = text.slice(0, pos);
  const after = text.slice(pos);
  const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const suffix = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
  return `${before}${prefix}${insertion}${suffix}${after}`;
};

const CommentInput: React.FC<CommentInputProps> = ({
  onSubmit,
  initialContent = "",
}) => {
  const [newComment, setNewComment] = useState<string>(initialContent);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  // When true, the input area renders the comment as it'll appear (in place of the
  // textarea) rather than opening a separate preview block.
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Ref so async upload callbacks always see the latest content value.
  const contentRef = useRef(newComment);
  useEffect(() => {
    contentRef.current = newComment;
  }, [newComment]);

  const { user } = useUserContext();
  const { showNotification } = useNotification();

  const handleSubmit = () => {
    if (newComment.trim()) {
      onSubmit(newComment);
      setNewComment("");
      setShowPreview(false);
    }
  };

  const canPreview = newComment.trim().length > 0;

  // Upload an image/video to Blossom and drop its URL into the comment, swapping a
  // placeholder in while it's in flight (same flow as the note composer).
  const uploadFile = async (file: File, cursorPos?: number) => {
    if (!user) {
      showNotification("Please log in to upload files", "warning");
      return;
    }
    const insertPos = cursorPos ?? contentRef.current.length;
    setNewComment(insertAtPosition(contentRef.current, UPLOAD_PLACEHOLDER, insertPos));
    setIsUploading(true);
    try {
      const url = await uploadToBlossom(file, getBlossomServer(), (template) =>
        signEvent(template, user.privateKey)
      );
      setNewComment(contentRef.current.replace(UPLOAD_PLACEHOLDER, url));
    } catch (err) {
      setNewComment(contentRef.current.replace(UPLOAD_PLACEHOLDER, ""));
      showNotification(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void uploadFile(file);
    e.target.value = ""; // allow re-selecting the same file
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = Array.from(e.dataTransfer.files).find(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
    );
    if (file) void uploadFile(file);
  };

  return (
    <div>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        <Tooltip title="Attach image or video">
          <span>
            <IconButton
              size="small"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              sx={{
                border: "1px solid",
                borderColor: "primary.main",
                borderRadius: "50%",
                color: "primary.main",
              }}
            >
              {isUploading ? (
                <CircularProgress size={18} />
              ) : (
                <AttachFileIcon fontSize="small" />
              )}
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title={showPreview ? "Back to editing" : "Preview"}>
          <span>
            <IconButton
              size="small"
              onClick={() => setShowPreview((v) => !v)}
              disabled={!canPreview}
              sx={{
                border: "1px solid",
                borderColor: showPreview ? "secondary.main" : "primary.main",
                borderRadius: "50%",
                color: showPreview ? "secondary.main" : "primary.main",
              }}
            >
              {showPreview ? (
                <VisibilityOffIcon fontSize="small" />
              ) : (
                <VisibilityIcon fontSize="small" />
              )}
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {isUploading && <LinearProgress sx={{ mb: 0.5, borderRadius: 1 }} />}

      <Box
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        sx={{
          position: "relative",
          outline: isDragOver ? "2px dashed" : "none",
          outlineColor: "primary.main",
          borderRadius: 1,
        }}
      >
        {showPreview ? (
          // Inline preview: the rendered comment occupies the same spot as the
          // textarea (no separate preview block).
          <Box
            onClick={() => setShowPreview(false)}
            sx={{
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
              p: 1.5,
              minHeight: 64,
              cursor: "text",
              overflowWrap: "anywhere",
            }}
          >
            <TextWithImages
              content={newComment}
              tags={extractMentionTags(newComment)}
            />
          </Box>
        ) : (
          <MentionTextArea
            label="Add a comment"
            value={newComment}
            onChange={setNewComment}
            minRows={2}
            maxRows={6}
            onFilePaste={(file, cursorPos) => void uploadFile(file, cursorPos)}
          />
        )}
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

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        style={{ display: "none" }}
        onChange={handleFileSelect}
      />

      <Button
        onClick={handleSubmit}
        variant="contained"
        color="secondary"
        disabled={isUploading}
        style={{ marginTop: 8 }}
      >
        Submit Comment
      </Button>
    </div>
  );
};

export default CommentInput;
