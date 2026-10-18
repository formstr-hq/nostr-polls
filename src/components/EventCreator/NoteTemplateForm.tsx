import { useSectionColorAt } from "../Shell/useSectionColor";
import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  Button,
  ButtonBase,
  Stack,
  Collapse,
  Typography,
  Chip,
  LinearProgress,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AddPhotoIcon from "@mui/icons-material/AddPhotoAlternateRounded";
import AlternateEmailIcon from "@mui/icons-material/AlternateEmailRounded";
import TagIcon from "@mui/icons-material/TagRounded";
import LockIcon from "@mui/icons-material/LockRounded";
import {
  ComposerDock,
  ComposerLabel,
  ComposerSlab,
  DockTool,
  WhoLine,
  insertAtCursor,
} from "./ComposerParts";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import dayjs, { Dayjs } from "dayjs";
import TimerOutlinedIcon from "@mui/icons-material/TimerOutlined";
import { useNotification } from "../../contexts/notification-context";
import { useUserContext } from "../../hooks/useUserContext";
import { useNavigate } from "react-router-dom";
import { NOTIFICATION_MESSAGES } from "../../constants/notifications";
import { NOSTR_EVENT_KINDS } from "../../constants/nostr";
import { signEvent } from "../../nostr";
import { useRelays } from "../../hooks/useRelays";
import { Event, nip19 } from "nostr-tools";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { NotePreview } from "./NotePreview";
import { dataLayer } from "@formstr/local-relay";
import { PublishDiagnosticModal } from "../Common/PublishDiagnosticModal";
import { usePublishDiagnostic } from "../../hooks/usePublishDiagnostic";
import MentionTextArea, { extractMentionTags } from "./MentionTextArea";
import EmojiPickerButton from "../Common/EmojiPickerButton";
import { PostEnhancementDialog } from "./PostEnhancementDialog";
import { aiService } from "../../services/ai-service";
import { useAppContext } from "../../hooks/useAppContext";
import { uploadToBlossom, getBlossomServer } from "../../services/blossomService";
import { copyToClipboard, extractHashtags } from "../../utils/common";
import { getAppBaseUrl } from "../../utils/platform";
import { AudienceMenu, Audience } from "./AudienceMenu";
import {
  generateViewKey,
  viewKeyToHex,
  encryptPrivateNote,
} from "../../nostr/privateNote";
import { TextField } from "@mui/material";
import { useDrafts } from "../../contexts/drafts-context";
import { NoteDraft, newDraftId } from "./draftModel";
import { useDraftAutosave } from "../../hooks/useDraftAutosave";

const UPLOAD_PLACEHOLDER = "[uploading…]";

const EXPIRY_PRESETS = [
  { label: "1h", seconds: 3600 },
  { label: "6h", seconds: 21600 },
  { label: "24h", seconds: 86400 },
  { label: "7d", seconds: 604800 },
];

const NoteTemplateForm: React.FC<{
  eventContent: string;
  setEventContent: (val: string) => void;
  quotedEvent?: Event;
  onPublished?: () => void;
  /** When provided, the parent handles the diagnostic modal instead of this form */
  onPublishResult?: (event: Event, result: import("@formstr/local-relay").PublishResult) => void;
  /** Hydrate the form from a previously saved local draft */
  initialDraft?: NoteDraft;
}> = ({ eventContent, setEventContent, quotedEvent, onPublished, onPublishResult, initialDraft }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [audience, setAudience] = useState<Audience>(
    initialDraft ? ({ kind: initialDraft.audienceKind } as Audience) : { kind: "public" }
  );
  // Set for private notes only — the decryptable share link shown inside the
  // publish diagnostic modal. Non-null means the open modal is a private note.
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const { result: publishResult, open: diagnosticOpen, setOpen: setDiagnosticOpen, title: diagnosticTitle, openModal, retry } = usePublishDiagnostic();
  const [showPreview, setShowPreview] = useState(false);
  const [topics, setTopics] = useState<string[]>([]);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [showEnhancementDialog, setShowEnhancementDialog] = useState(false);
  const [enhancementSuggestions, setEnhancementSuggestions] = useState<any>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [expiresInSeconds, setExpiresInSeconds] = useState<number | null>(initialDraft?.expiresInSeconds ?? null);
  const [customExpiryDate, setCustomExpiryDate] = useState<Dayjs | null>(null);
  const [showExpiry, setShowExpiry] = useState(!!initialDraft?.expiresInSeconds);
  const [draftId, setDraftId] = useState<string | undefined>(initialDraft?.id);
  const [draftSavedAt, setDraftSavedAt] = useState<number | undefined>(initialDraft?.updated_at);
  const { saveDraft, deleteDraft } = useDrafts();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  // Ref so async upload callbacks always see the latest content value
  const eventContentRef = useRef(eventContent);
  useEffect(() => { eventContentRef.current = eventContent; }, [eventContent]);

  const insertEmoji = (emoji: string) => {
    const el = textAreaRef.current;
    const current = eventContentRef.current;
    const pos = el?.selectionStart ?? current.length;
    const next = current.slice(0, pos) + emoji + current.slice(pos);
    setEventContent(next);
    const newPos = pos + emoji.length;
    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(newPos, newPos);
      }
    });
  };
  const { showNotification } = useNotification();
  const { user } = useUserContext();
  const { relays, writeRelays } = useRelays();
  const { aiSettings } = useAppContext();
  const navigate = useNavigate();

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

  const saveDraftNow = async () => {
    const now = Date.now();
    const draft: NoteDraft = {
      id: draftId ?? newDraftId(),
      kind: "note",
      eventContent,
      audienceKind: audience.kind,
      expiresInSeconds,
      created_at: initialDraft?.created_at ?? now,
      updated_at: now,
    };
    await saveDraft(draft);
    setDraftId(draft.id);
    setDraftSavedAt(draft.updated_at);
  };

  const autosaveStatus = useDraftAutosave(saveDraftNow, eventContent.trim().length > 0, [
    eventContent,
    audience.kind,
    expiresInSeconds,
  ]);

  const publishNoteEvent = async (secret?: string) => {
    try {
      if (!eventContent.trim()) {
        showNotification(NOTIFICATION_MESSAGES.EMPTY_NOTE_CONTENT, "error");
        return;
      }
      let finalContent = eventContent;
      const quoteTags: string[][] = [];
      if (quotedEvent) {
        try {
          const neventId = nip19.neventEncode({ id: quotedEvent.id, relays: relays.slice(0, 2), kind: quotedEvent.kind });
          finalContent = `${eventContent}\n\nnostr:${neventId}`;
          quoteTags.push(["q", quotedEvent.id, relays[0] || ""]);
          quoteTags.push(["p", quotedEvent.pubkey]);
        } catch { /* skip if encoding fails */ }
      }

      const mentionTags = extractMentionTags(eventContent);
      const now = Math.floor(Date.now() / 1000);
      const expirationTs = customExpiryDate
        ? customExpiryDate.unix()
        : expiresInSeconds
        ? now + expiresInSeconds
        : null;

      // Private notes strip all content-revealing tags (topics, mentions, quote refs,
      // relay hints) — those would let relays/scrapers learn what the encrypted note
      // is about or who it references. Quotes/mentions remain inline in the encrypted
      // content, so readers with the ViewKey still see them.
      const isPrivate = audience.kind === "private";
      let viewKey: Uint8Array | null = null;
      let eventContentToPublish = finalContent;
      let eventKind: number = NOSTR_EVENT_KINDS.TEXT_NOTE;
      let eventTags: string[][];

      if (isPrivate) {
        viewKey = generateViewKey();
        eventContentToPublish = encryptPrivateNote(finalContent, viewKey);
        eventKind = NOSTR_EVENT_KINDS.PRIVATE_NOTE;
        eventTags = expirationTs ? [["expiration", String(expirationTs)]] : [];
      } else {
        eventTags = [
          ...relays.map((relay) => ["relay", relay]),
          ...topics.map((tag) => ["t", tag]),
          ...mentionTags,
          ...quoteTags,
          ...(expirationTs ? [["expiration", String(expirationTs)]] : []),
        ];
      }

      const noteEvent = {
        kind: eventKind,
        content: eventContentToPublish,
        tags: eventTags,
        created_at: now,
      };
      setIsSubmitting(true);
      const signedEvent = await signEvent(noteEvent, user?.privateKey);
      if (!signedEvent) {
        setIsSubmitting(false);
        showNotification(NOTIFICATION_MESSAGES.NOTE_SIGN_FAILED, "error");
        return;
      }
      const result = await dataLayer.publishEvent(signedEvent);
      setIsSubmitting(false);

      if (isPrivate && viewKey) {
        const nevent = nip19.neventEncode({
          id: signedEvent.id,
          relays: writeRelays.slice(0, 2),
          kind: signedEvent.kind,
          author: signedEvent.pubkey,
        });
        const url = `${getAppBaseUrl()}/p/${nevent}#k=${viewKeyToHex(viewKey)}`;
        // Reuse the publish diagnostic modal so private notes get the same
        // per-relay retry / "retry all failed" affordance as public notes. The
        // share link rides along as the modal's header content.
        setShareUrl(url);
        openModal(signedEvent, result, "Private note published");
        if (!result.ok) {
          showNotification(NOTIFICATION_MESSAGES.NOTE_PUBLISH_NO_RELAY, "error");
        }
        return;
      }

      if (onPublishResult) {
        onPublishResult(signedEvent, result);
      } else {
        openModal(signedEvent, result, "Note publish results");
      }
      if (!result.ok) {
        showNotification(NOTIFICATION_MESSAGES.NOTE_PUBLISH_NO_RELAY, "error");
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

  const hasExpiry = !!(expiresInSeconds || customExpiryDate);
  const noteColor = useSectionColorAt(0);
  const expiryLabel = customExpiryDate
    ? customExpiryDate.format("MMM D, HH:mm")
    : EXPIRY_PRESETS.find((p) => p.seconds === expiresInSeconds)?.label;
  const insertText = (text: string) =>
    insertAtCursor(textAreaRef.current, eventContentRef.current, text, setEventContent);

  return (
    <form onSubmit={handleSubmit}>
      <Stack spacing={1.25}>
        {/* Editor slab — drag-and-drop zone wraps the whole thing */}
        <ComposerSlab
          sx={{
            position: "relative",
            outline: isDragOver ? "2px dashed" : "none",
            outlineColor: "secondary.main",
          }}
        >
          <Box onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
            <WhoLine autosaveStatus={autosaveStatus} savedAt={draftSavedAt} />
            <MentionTextArea
              label="Note content"
              bare
              fontSize={19}
              minRows={5}
              maxRows={16}
              value={eventContent}
              onChange={setEventContent}
              required
              placeholder="What's on your mind? Use @mentions and #hashtags."
              onFilePaste={(file, cursorPos) => uploadFile(file, cursorPos)}
              inputRef={textAreaRef}
            />
            {isUploading && <LinearProgress color="secondary" sx={{ mt: 1, borderRadius: 1 }} />}
            {isDragOver && (
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: "action.hover",
                  borderRadius: "26px",
                  pointerEvents: "none",
                }}
              >
                <Typography variant="body2" color="secondary">
                  Drop to upload
                </Typography>
              </Box>
            )}
          </Box>

          {/* Audience + expiry chips */}
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center", mt: 1.5 }}>
            <AudienceMenu value={audience} onChange={setAudience} disabled={isSubmitting} />
            {hasExpiry && (
              <Chip
                icon={<TimerOutlinedIcon />}
                label={`Disappears ${customExpiryDate ? "at " : "in "}${expiryLabel}`}
                color="warning"
                variant="outlined"
                onClick={() => setShowExpiry(true)}
                onDelete={() => {
                  setExpiresInSeconds(null);
                  setCustomExpiryDate(null);
                }}
              />
            )}
          </Box>
          {audience.kind === "private" && (
            <Typography variant="caption" color="warning.main" sx={{ display: "block", mt: 1 }}>
              You'll get a share link. Save it — we don't store the key, so losing the link means losing access.
            </Typography>
          )}

          {topics.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <ComposerLabel>Topics</ComposerLabel>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {topics.map((topic, index) => (
                  <Chip
                    key={index}
                    label={`#${topic}`}
                    size="small"
                    sx={{
                      bgcolor: (t) => alpha(t.palette.secondary.main, 0.12),
                      color: "secondary.main",
                      opacity: audience.kind === "private" ? 0.4 : 1,
                    }}
                  />
                ))}
              </Stack>
              {audience.kind === "private" && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                  Hashtags stay in your post but aren't published as topic tags.
                </Typography>
              )}
            </Box>
          )}

          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
            Paste or drag & drop images and videos to attach.
          </Typography>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />
        </ComposerSlab>

        {/* Disappearing note (NIP-40) */}
        <Collapse in={showExpiry} unmountOnExit>
          <ComposerSlab>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <ComposerLabel>Disappearing note</ComposerLabel>
              <Button size="small" onClick={() => setShowExpiry(false)}>
                Done
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
              Relays that support NIP-40 delete the note after this time.
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, mb: 1.5 }}>
              {EXPIRY_PRESETS.map(({ label, seconds }) => {
                const on = expiresInSeconds === seconds && !customExpiryDate;
                return (
                  <ButtonBase
                    key={label}
                    onClick={() => {
                      setCustomExpiryDate(null);
                      setExpiresInSeconds(on ? null : seconds);
                    }}
                    aria-pressed={on}
                    sx={{
                      height: 52,
                      borderRadius: "16px",
                      fontFamily: "inherit",
                      fontWeight: 800,
                      fontSize: 16,
                      background: on ? noteColor.fill : undefined,
                      bgcolor: on ? undefined : "cb.inner",
                      color: on ? noteColor.on : "text.primary",
                    }}
                  >
                    {label}
                  </ButtonBase>
                );
              })}
            </Box>
            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <DateTimePicker
                label="Custom date & time"
                value={customExpiryDate}
                onChange={(val) => {
                  setCustomExpiryDate(val);
                  if (val) setExpiresInSeconds(null);
                }}
                minDateTime={dayjs().add(1, "minute")}
                slotProps={{ textField: { fullWidth: true, size: "small" } }}
              />
            </LocalizationProvider>
          </ComposerSlab>
        </Collapse>

        <Collapse in={showPreview} unmountOnExit>
          <ComposerSlab>
            <ComposerLabel>Preview</ComposerLabel>
            <NotePreview noteEvent={previewEvent} />
          </ComposerSlab>
        </Collapse>

        <ComposerDock
          submitting={isSubmitting}
          disabled={!eventContent.trim()}
          submitLabel={
            audience.kind === "private" ? (
              <>
                <LockIcon sx={{ fontSize: 18 }} /> Post
              </>
            ) : (
              "Post"
            )
          }
          tools={
            <>
              <DockTool
                title="Attach image or video (Blossom)"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSubmitting}
                busy={isUploading}
              >
                <AddPhotoIcon />
              </DockTool>
              <EmojiPickerButton
                onSelect={insertEmoji}
                disabled={isSubmitting}
                tooltip="Insert emoji"
                placement="top-start"
                iconButtonSx={{ width: 42, height: 42, color: "rgba(255,255,255,0.85)" }}
              />
              <DockTool title="Mention someone" onClick={() => insertText("@")}>
                <AlternateEmailIcon />
              </DockTool>
              <DockTool title="Add a hashtag" onClick={() => insertText("#")}>
                <TagIcon />
              </DockTool>
              <DockTool
                title={hasExpiry ? "Edit expiration" : "Set expiration (NIP-40)"}
                onClick={() => setShowExpiry((v) => !v)}
                warn={hasExpiry}
                active={showExpiry}
              >
                <TimerOutlinedIcon />
              </DockTool>
              {aiSettings.model && (
                <DockTool title="Proofread with AI" onClick={handleProofread} busy={isEnhancing} disabled={isSubmitting}>
                  <AutoFixHighIcon />
                </DockTool>
              )}
              <DockTool
                title={showPreview ? "Hide preview" : "Show preview"}
                onClick={() => setShowPreview((v) => !v)}
                active={showPreview}
              >
                {showPreview ? <VisibilityOffIcon /> : <VisibilityIcon />}
              </DockTool>
            </>
          }
        />
      </Stack>

      <PostEnhancementDialog
        open={showEnhancementDialog}
        onClose={() => setShowEnhancementDialog(false)}
        suggestions={enhancementSuggestions}
        originalText={eventContent}
        onApply={handleApplySuggestions}
      />
      {publishResult && (
        <PublishDiagnosticModal
          open={diagnosticOpen}
          onClose={() => {
            setDiagnosticOpen(false);
            if (shareUrl) {
              // Private note: clear the editor + link and let the parent decide
              // where to go. (The user has already been shown the link to save.)
              if (draftId) {
                deleteDraft(draftId);
                setDraftId(undefined);
                setDraftSavedAt(undefined);
              }
              setShareUrl(null);
              setEventContent("");
              if (onPublished) onPublished();
            } else if (publishResult.ok) {
              if (draftId) {
                deleteDraft(draftId);
                setDraftId(undefined);
                setDraftSavedAt(undefined);
              }
              if (onPublished) onPublished();
              else navigate("/feeds/notes");
            }
          }}
          title={diagnosticTitle}
          entries={publishResult.relayResults}
          onRetry={retry}
          headerContent={
            shareUrl ? (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Anyone with this link can read the note. We don't store the key —
                  save the link somewhere safe.
                </Typography>
                <TextField
                  fullWidth
                  multiline
                  value={shareUrl}
                  InputProps={{
                    readOnly: true,
                    sx: { fontFamily: "monospace", fontSize: "0.8rem" },
                  }}
                  onFocus={(e) => e.target.select()}
                />
                <Button
                  size="small"
                  startIcon={<ContentCopyIcon />}
                  sx={{ mt: 1 }}
                  onClick={async () => {
                    try {
                      await copyToClipboard(shareUrl);
                      showNotification("Link copied", "success");
                    } catch {
                      showNotification("Copy failed — select and copy manually", "error");
                    }
                  }}
                >
                  Copy link
                </Button>
              </Box>
            ) : undefined
          }
        />
      )}
    </form>
  );
};

export default NoteTemplateForm;
