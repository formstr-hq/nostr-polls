import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  ButtonBase,
  Stack,
  TextField,
  Typography,
  Collapse,
  Chip,
  LinearProgress,
} from "@mui/material";
import MentionTextArea, { extractMentionTags } from "./MentionTextArea";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { DateTimePicker } from "@mui/x-date-pickers";
import dayjs from "dayjs";
import RadioButtonCheckedIcon from "@mui/icons-material/RadioButtonChecked";
import CheckBoxIcon from "@mui/icons-material/CheckBox";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import OptionsCard, { duplicateOf } from "./OptionsCard";
import { alpha } from "@mui/material/styles";
import AddPhotoIcon from "@mui/icons-material/AddPhotoAlternateRounded";
import AlternateEmailIcon from "@mui/icons-material/AlternateEmailRounded";
import TagIcon from "@mui/icons-material/TagRounded";
import EmojiPickerButton from "../Common/EmojiPickerButton";
import {
  ComposerDock,
  ComposerLabel,
  ComposerSlab,
  DockTool,
  WhoLine,
  insertAtCursor,
} from "./ComposerParts";
import { Option } from "../../interfaces";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { useNotification } from "../../contexts/notification-context";
import { useUserContext } from "../../hooks/useUserContext";
import { useNavigate } from "react-router-dom";
import { NOTIFICATION_MESSAGES } from "../../constants/notifications";
import { NOSTR_EVENT_KINDS } from "../../constants/nostr";
import { signEvent } from "../../nostr";
import { useRelays } from "../../hooks/useRelays";
import { PollPreview } from "./PollPreview";
import { Event, nip19 } from "nostr-tools";
import { dataLayer } from "@formstr/local-relay";
import { PublishDiagnosticModal } from "../Common/PublishDiagnosticModal";
import { usePublishDiagnostic } from "../../hooks/usePublishDiagnostic";
import { extractHashtags } from "../../utils/common";
import { uploadToBlossom, getBlossomServer } from "../../services/blossomService";
import { useDrafts } from "../../contexts/drafts-context";
import { PollDraft, newDraftId } from "./draftModel";
import { useDraftAutosave } from "../../hooks/useDraftAutosave";

const UPLOAD_PLACEHOLDER = "[uploading…]";

const insertAtPosition = (text: string, insertion: string, pos: number): string => {
  const before = text.slice(0, pos);
  const after = text.slice(pos);
  const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const suffix = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
  return `${before}${prefix}${insertion}${suffix}${after}`;
};

const generateOptionId = (): string => {
  return Math.random().toString(36).substr(2, 9);
};

const pollOptions = [
  {
    value: "singlechoice",
    icon: <RadioButtonCheckedIcon fontSize="small" />,
    label: "Single Choice Poll",
    short: "Single",
  },
  {
    value: "multiplechoice",
    icon: <CheckBoxIcon fontSize="small" />,
    label: "Multiple Choice Poll",
    short: "Multiple",
  },
  {
    value: "rankedchoice",
    icon: <FormatListNumberedIcon fontSize="small" />,
    label: "Ranked Choice Poll",
    short: "Ranked",
    disabled: true,
  },
];

// One tap fills the options; plain pre-filled labels, no protocol change.
const POLL_TEMPLATES = [
  { name: "Yes / No", emoji: "👍", options: ["Yes", "No"] },
  { name: "Rate it", emoji: "⭐", options: ["⭐", "⭐⭐", "⭐⭐⭐", "⭐⭐⭐⭐", "⭐⭐⭐⭐⭐"] },
  { name: "This or that", emoji: "🆚", options: ["This", "That"] },
  { name: "Emoji scale", emoji: "😍", options: ["😍", "🙂", "😐", "🙁", "😡"] },
];

// Quick "voting ends" presets (seconds from now); null = never.
const DURATION_PRESETS: { label: string; seconds: number | null }[] = [
  { label: "1h", seconds: 3600 },
  { label: "1d", seconds: 86400 },
  { label: "3d", seconds: 3 * 86400 },
  { label: "1w", seconds: 7 * 86400 },
  { label: "∞", seconds: null },
];

// Proof-of-work levels for the PoW tag voters must satisfy.
const POW_PRESETS = [
  { label: "Off", bits: 0, hint: "instant" },
  { label: "Low", bits: 16, hint: "~1 sec" },
  { label: "Medium", bits: 20, hint: "~10 sec" },
  { label: "High", bits: 24, hint: "~1 min" },
];

const PollTemplateForm: React.FC<{
  eventContent: string;
  setEventContent: (val: string) => void;
  quotedEvent?: Event;
  onPublished?: () => void;
  /** When provided, the parent handles the diagnostic modal instead of this form */
  onPublishResult?: (event: Event, result: import("@formstr/local-relay").PublishResult) => void;
  /** Hydrate the form from a previously saved local draft */
  initialDraft?: PollDraft;
}> = ({ eventContent, setEventContent, quotedEvent, onPublished, onPublishResult, initialDraft }) => {
  const [showPreview, setShowPreview] = useState(false);
  const [options, setOptions] = useState<Option[]>(
    initialDraft?.options ?? [
      [generateOptionId(), ""],
      [generateOptionId(), ""],
    ]
  );
  const [pollType, setPollType] = useState<string>(
    initialDraft?.pollType ?? pollOptions[0]?.value ?? "singlechoice"
  );
  const [poW, setPoW] = useState<number | null>(initialDraft?.poW ?? null);
  const [expiration, setExpiration] = useState<number | null>(initialDraft?.expiration ?? null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draftId, setDraftId] = useState<string | undefined>(initialDraft?.id);
  const [draftSavedAt, setDraftSavedAt] = useState<number | undefined>(initialDraft?.updated_at);
  const { saveDraft, deleteDraft } = useDrafts();
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadingOptionIndex, setUploadingOptionIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const questionRef = useRef<HTMLTextAreaElement | null>(null);
  const optionFileInputRef = useRef<HTMLInputElement>(null);
  const pendingOptionIndexRef = useRef<number | null>(null);
  const eventContentRef = useRef(eventContent);
  useEffect(() => { eventContentRef.current = eventContent; }, [eventContent]);
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; }, [options]);
  const { result: publishResult, open: diagnosticOpen, setOpen: setDiagnosticOpen, title: diagnosticTitle, openModal, retry } = usePublishDiagnostic();
  const [topics, setTopics] = useState<string[]>([]);

  const { showNotification } = useNotification();
  const { user } = useUserContext();
  const { relays } = useRelays();
  const navigate = useNavigate();
  const now = dayjs();

  const uploadQuestionFile = async (file: File, cursorPos?: number) => {
    if (!user) { showNotification("Please log in to upload files", "warning"); return; }
    const insertPos = cursorPos ?? eventContentRef.current.length;
    setEventContent(insertAtPosition(eventContentRef.current, UPLOAD_PLACEHOLDER, insertPos));
    setIsUploading(true);
    try {
      const url = await uploadToBlossom(file, getBlossomServer(), (template) => signEvent(template, user.privateKey));
      setEventContent(eventContentRef.current.replace(UPLOAD_PLACEHOLDER, url));
    } catch (err) {
      setEventContent(eventContentRef.current.replace(UPLOAD_PLACEHOLDER, ""));
      showNotification(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setIsUploading(false);
    }
  };

  const uploadOptionFile = async (file: File, optionIndex: number, cursorPos?: number) => {
    if (!user) { showNotification("Please log in to upload files", "warning"); return; }
    const currentOptions = [...optionsRef.current];
    const currentLabel = currentOptions[optionIndex][1];
    const insertPos = cursorPos ?? currentLabel.length;
    currentOptions[optionIndex] = [currentOptions[optionIndex][0], insertAtPosition(currentLabel, UPLOAD_PLACEHOLDER, insertPos)];
    setOptions(currentOptions);
    setUploadingOptionIndex(optionIndex);
    try {
      const url = await uploadToBlossom(file, getBlossomServer(), (template) => signEvent(template, user.privateKey));
      const latest = [...optionsRef.current];
      latest[optionIndex] = [latest[optionIndex][0], latest[optionIndex][1].replace(UPLOAD_PLACEHOLDER, url)];
      setOptions(latest);
    } catch (err) {
      const latest = [...optionsRef.current];
      latest[optionIndex] = [latest[optionIndex][0], latest[optionIndex][1].replace(UPLOAD_PLACEHOLDER, "")];
      setOptions(latest);
      showNotification(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setUploadingOptionIndex(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = Array.from(e.dataTransfer.files).find(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
    );
    if (file) uploadQuestionFile(file);
  };

  const addOption = () => {
    setOptions([...options, [generateOptionId(), ""]]);
  };

  const onEditOptions = (newOptions: Option[]) => {
    setOptions(newOptions);
  };

  const removeOption = (index: number) => {
    const updatedOptions = [...options];
    updatedOptions.splice(index, 1);
    setOptions(updatedOptions);
  };

  useEffect(() => {
    setTopics(extractHashtags(eventContent));
  }, [eventContent]);

  const saveDraftNow = async () => {
    const now = Date.now();
    const draft: PollDraft = {
      id: draftId ?? newDraftId(),
      kind: "poll",
      eventContent,
      options,
      pollType,
      poW,
      expiration,
      created_at: initialDraft?.created_at ?? now,
      updated_at: now,
    };
    await saveDraft(draft);
    setDraftId(draft.id);
    setDraftSavedAt(draft.updated_at);
  };

  const hasDraftableContent =
    eventContent.trim().length > 0 || options.some((o) => o[1].trim().length > 0);
  const autosaveStatus = useDraftAutosave(saveDraftNow, hasDraftableContent, [
    eventContent,
    options,
    pollType,
    poW,
    expiration,
  ]);

  const publishPollEvent = async (secret?: string) => {
    try {
      if (!eventContent.trim()) {
        showNotification(NOTIFICATION_MESSAGES.EMPTY_POLL_QUESTION, "error");
        return;
      }
      if (options.length < 1) {
        showNotification(NOTIFICATION_MESSAGES.MIN_POLL_OPTIONS, "error");
        return;
      }
      if (options.some((option) => option[1].trim() === "")) {
        showNotification(NOTIFICATION_MESSAGES.EMPTY_POLL_OPTIONS, "error");
        return;
      }
      if (options.some((_, i) => duplicateOf(options, i) >= 0)) {
        showNotification("Two options are the same — edit or remove one.", "error");
        return;
      }

      // If quoting another event, embed its nevent reference in the content
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
      const pollEvent = {
        kind: NOSTR_EVENT_KINDS.POLL,
        content: finalContent,
        tags: [
          ...options.map((option: Option) => ["option", option[0], option[1]]),
          ...relays.map((relay) => ["relay", relay]),
          ...topics.map((tag) => ["t", tag]),
          ...mentionTags,
          ...quoteTags,
        ],
        created_at: Math.floor(Date.now() / 1000),
      };

      if (poW) pollEvent.tags.push(["PoW", poW.toString()]);
      if (pollType) pollEvent.tags.push(["polltype", pollType]);
      if (expiration) pollEvent.tags.push(["endsAt", expiration.toString()]);

      setIsSubmitting(true);
      const signedEvent = await signEvent(pollEvent, user?.privateKey);
      if (!signedEvent) {
        setIsSubmitting(false);
        showNotification(NOTIFICATION_MESSAGES.POLL_SIGN_FAILED, "error");
        return;
      }
      const result = await dataLayer.publishEvent(signedEvent);
      setIsSubmitting(false);
      if (onPublishResult) {
        onPublishResult(signedEvent, result);
      } else {
        openModal(signedEvent, result, "Poll publish results");
      }
      if (!result.ok) {
        showNotification(NOTIFICATION_MESSAGES.POLL_PUBLISH_NO_RELAY, "error");
      }
    } catch (error) {
      setIsSubmitting(false);
      console.error("Error publishing poll:", error);
      showNotification(NOTIFICATION_MESSAGES.POLL_PUBLISH_FAILED, "error");
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    publishPollEvent(user?.privateKey);
  };

  const previewEvent: Partial<Event> = {
    content: eventContent,
    tags: [
      ...options.map((option: Option) => ["option", option[0], option[1]]),
      ["polltype", pollType],
      ...(expiration ? [["endsAt", expiration.toString()]] : []),
      ...(poW ? [["PoW", poW.toString()]] : []),
      ...topics.map((tag) => ["t", tag]),
    ],
  };

  const allOptionsEmpty = options.every((o) => o[1].trim() === "");
  const applyTemplate = (labels: string[]) =>
    setOptions(labels.map((label) => [generateOptionId(), label] as Option));
  const nowSec = Math.floor(Date.now() / 1000);
  const insertText = (text: string) =>
    insertAtCursor(questionRef.current, eventContentRef.current, text, setEventContent);

  return (
    <form onSubmit={handleSubmit}>
      <Stack spacing={1.25}>
        {/* Question slab — drag-and-drop zone */}
        <ComposerSlab
          sx={{ position: "relative", outline: isDragOver ? "2px dashed" : "none", outlineColor: "secondary.main" }}
        >
          <Box onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
            <WhoLine autosaveStatus={autosaveStatus} savedAt={draftSavedAt} />
            <MentionTextArea
              label="Poll question"
              bare
              fontSize={21}
              fontWeight={700}
              minRows={2}
              maxRows={10}
              value={eventContent}
              onChange={setEventContent}
              required
              placeholder="Ask a question…"
              onFilePaste={(file, cursorPos) => uploadQuestionFile(file, cursorPos)}
              inputRef={questionRef}
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
                <Typography variant="body2" color="secondary">Drop to upload</Typography>
              </Box>
            )}
          </Box>
          {topics.length > 0 && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
              {topics.map((topic, index) => (
                <Chip
                  key={index}
                  label={`#${topic}`}
                  size="small"
                  sx={{ bgcolor: (t) => alpha(t.palette.secondary.main, 0.12), color: "secondary.main" }}
                />
              ))}
            </Stack>
          )}
          {/* Hidden file input for question */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadQuestionFile(file);
              e.target.value = "";
            }}
          />
          {/* Hidden file input for options */}
          <input
            ref={optionFileInputRef}
            type="file"
            accept="image/*,video/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && pendingOptionIndexRef.current !== null) {
                uploadOptionFile(file, pendingOptionIndexRef.current);
              }
              e.target.value = "";
            }}
          />
        </ComposerSlab>

        <ComposerSlab>
          <ComposerLabel>Options</ComposerLabel>
          <OptionsCard
            onAddOption={addOption}
            onRemoveOption={removeOption}
            onEditOptions={onEditOptions}
            options={options}
            onPasteFile={(file, index, cursorPos) => uploadOptionFile(file, index, cursorPos)}
            onClickAttach={(index) => {
              pendingOptionIndexRef.current = index;
              optionFileInputRef.current?.click();
            }}
            uploadingIndex={uploadingOptionIndex}
          />
          {allOptionsEmpty && (
            <Box sx={{ mt: 2 }}>
              <ComposerLabel>Or start from a template</ComposerLabel>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {POLL_TEMPLATES.map((tpl) => (
                  <Chip
                    key={tpl.name}
                    label={`${tpl.emoji} ${tpl.name}`}
                    onClick={() => applyTemplate(tpl.options)}
                    sx={{ bgcolor: "cb.inner", fontWeight: 700 }}
                  />
                ))}
              </Stack>
            </Box>
          )}
        </ComposerSlab>

        {/* Settings */}
        <ComposerSlab>
          <ComposerLabel>Answer type</ComposerLabel>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1 }}>
            {pollOptions.map((option) => {
              const on = pollType === option.value;
              return (
                <ButtonBase
                  key={option.value}
                  disabled={option.disabled}
                  onClick={() => setPollType(option.value)}
                  aria-pressed={on}
                  sx={{
                    flexDirection: "column",
                    gap: 0.5,
                    py: 1.25,
                    px: 0.5,
                    borderRadius: "16px",
                    fontFamily: "inherit",
                    fontWeight: 700,
                    fontSize: 13,
                    bgcolor: on ? "cb.poll" : "cb.inner",
                    color: on ? "cb.onPoll" : "text.primary",
                    opacity: option.disabled ? 0.45 : 1,
                  }}
                >
                  {option.icon}
                  {option.short}
                  {option.disabled && (
                    <Typography component="span" sx={{ fontSize: 10.5, fontWeight: 700, opacity: 0.8 }}>
                      Coming soon
                    </Typography>
                  )}
                </ButtonBase>
              );
            })}
          </Box>

          <Box sx={{ mt: 2.5 }}>
            <ComposerLabel>Voting ends</ComposerLabel>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 1, mb: 1.25 }}>
              {DURATION_PRESETS.map(({ label, seconds }) => {
                const target = seconds === null ? null : nowSec + seconds;
                const on =
                  seconds === null
                    ? expiration === null
                    : expiration !== null && Math.abs(expiration - (target as number)) < 90;
                return (
                  <ButtonBase
                    key={label}
                    aria-pressed={on}
                    onClick={() => setExpiration(target)}
                    sx={{
                      height: 44,
                      borderRadius: "14px",
                      fontFamily: "inherit",
                      fontWeight: 800,
                      fontSize: 14,
                      bgcolor: on ? "cb.poll" : "cb.inner",
                      color: on ? "cb.onPoll" : "text.primary",
                    }}
                  >
                    {label}
                  </ButtonBase>
                );
              })}
            </Box>
            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <DateTimePicker
                label="Ends at"
                disablePast
                value={expiration ? dayjs.unix(expiration) : null}
                onChange={(value: dayjs.Dayjs | null) => {
                  if (!value) return;
                  if (value?.isBefore(now)) {
                    showNotification(
                      NOTIFICATION_MESSAGES.PAST_DATE_ERROR,
                      "error"
                    );
                    setExpiration(null);
                    return;
                  } else if (value.isValid()) {
                    setExpiration(value.unix());
                  }
                }}
                slotProps={{ textField: { fullWidth: true, size: "small" } }}
              />
            </LocalizationProvider>
          </Box>

          <Box sx={{ mt: 2.5 }}>
            <ComposerLabel>Spam protection</ComposerLabel>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: -0.5, mb: 1.25 }}>
              Each vote must include a proof-of-work. Higher levels make voters wait longer.
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, mb: 1.25 }}>
              {POW_PRESETS.map(({ label, bits, hint }) => {
                const on = (poW ?? 0) === bits;
                return (
                  <ButtonBase
                    key={label}
                    aria-pressed={on}
                    onClick={() => setPoW(bits || null)}
                    sx={{
                      flexDirection: "column",
                      height: 52,
                      borderRadius: "14px",
                      fontFamily: "inherit",
                      fontWeight: 800,
                      fontSize: 14,
                      bgcolor: on ? "cb.poll" : "cb.inner",
                      color: on ? "cb.onPoll" : "text.primary",
                    }}
                  >
                    {label}
                    <Typography component="span" sx={{ fontSize: 10.5, fontWeight: 600, opacity: 0.75 }}>
                      {hint}
                    </Typography>
                  </ButtonBase>
                );
              })}
            </Box>
            <TextField
              type="number"
              size="small"
              label="Difficulty (bits)"
              value={poW || ""}
              onChange={(e) => setPoW(Number(e.target.value) || null)}
              fullWidth
            />
          </Box>
        </ComposerSlab>

        <Collapse in={showPreview} unmountOnExit>
          <ComposerSlab>
            <ComposerLabel>Preview</ComposerLabel>
            <PollPreview pollEvent={previewEvent} />
          </ComposerSlab>
        </Collapse>

        <ComposerDock
          poll
          submitting={isSubmitting}
          disabled={!eventContent.trim() || options.some((o, i) => duplicateOf(options, i) >= 0)}
          submitLabel="Post"
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
                onSelect={(emoji) => insertText(emoji)}
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
      {publishResult && (
        <PublishDiagnosticModal
          open={diagnosticOpen}
          onClose={() => {
            setDiagnosticOpen(false);
            if (publishResult.ok) {
              if (draftId) {
                deleteDraft(draftId);
                setDraftId(undefined);
                setDraftSavedAt(undefined);
              }
              if (onPublished) onPublished();
              else navigate("/feeds/polls");
            }
          }}
          title={diagnosticTitle}
          entries={publishResult.relayResults}
          onRetry={retry}
        />
      )}
    </form>
  );
};

export default PollTemplateForm;
