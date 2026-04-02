import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  Button,
  Stack,
  TextField,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Collapse,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
  LinearProgress,
} from "@mui/material";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import MentionTextArea, { extractMentionTags } from "./MentionTextArea";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import Grid from "@mui/material/Grid2";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { DateTimePicker } from "@mui/x-date-pickers";
import dayjs from "dayjs";
import RadioButtonCheckedIcon from "@mui/icons-material/RadioButtonChecked";
import CheckBoxIcon from "@mui/icons-material/CheckBox";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import OptionsCard from "./OptionsCard";
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
import { publishWithGossip } from "../../utils/publish";
import { PublishDiagnosticModal } from "../Common/PublishDiagnosticModal";
import { usePublishDiagnostic } from "../../hooks/usePublishDiagnostic";
import { extractHashtags } from "../../utils/common";
import { uploadToBlossom, getBlossomServer } from "../../services/blossomService";

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
  },
  {
    value: "multiplechoice",
    icon: <CheckBoxIcon fontSize="small" />,
    label: "Multiple Choice Poll",
  },
  {
    value: "rankedchoice",
    icon: <FormatListNumberedIcon fontSize="small" />,
    label: "Ranked Choice Poll",
    disabled: true,
  },
];

const PollTemplateForm: React.FC<{
  eventContent: string;
  setEventContent: (val: string) => void;
  quotedEvent?: Event;
  onPublished?: () => void;
  /** When provided, the parent handles the diagnostic modal instead of this form */
  onPublishResult?: (event: Event, result: import("../../utils/publish").PublishResult) => void;
}> = ({ eventContent, setEventContent, quotedEvent, onPublished, onPublishResult }) => {
  const [showPreview, setShowPreview] = useState(false);
  const [options, setOptions] = useState<Option[]>([
    [generateOptionId(), ""],
    [generateOptionId(), ""],
  ]);
  const [pollType, setPollType] = useState<string>(
    pollOptions[0]?.value || "singlechoice"
  );
  const [poW, setPoW] = useState<number | null>(null);
  const [expiration, setExpiration] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadingOptionIndex, setUploadingOptionIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const { relays, writeRelays } = useRelays();
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
      const result = await publishWithGossip(writeRelays, signedEvent);
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

  const handleChange = (event: any) => {
    setPollType(event.target.value);
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
                  {isUploading ? <CircularProgress size={18} /> : <AttachFileIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
            <Typography variant="caption" color="text.secondary">
              Paste or drag &amp; drop images/videos to attach
            </Typography>
          </Box>

          {isUploading && <LinearProgress sx={{ mb: 0.5, borderRadius: 1 }} />}

          {/* Drag-and-drop zone */}
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
              label="Poll Question"
              value={eventContent}
              onChange={setEventContent}
              required
              placeholder="Ask a question. Use @mentions and #hashtags."
              onFilePaste={(file, cursorPos) => uploadQuestionFile(file, cursorPos)}
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
                <Typography variant="body2" color="primary">Drop to upload</Typography>
              </Box>
            )}
          </Box>

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

        <Box>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Poll Options
          </Typography>
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
        </Box>

        <Box>
          <Typography variant="h6" sx={{ mb: 3 }}>
            Poll Settings
          </Typography>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth>
                <InputLabel id="poll-type-label">Poll Type</InputLabel>
                <Select
                  labelId="poll-type-label"
                  id="poll-type-select"
                  value={pollType}
                  label="Poll Type"
                  onChange={handleChange}
                >
                  {pollOptions.map((option) => (
                    <MenuItem
                      key={option.value}
                      value={option.value}
                      disabled={option.disabled}
                    >
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        {option.icon}
                        <Typography>{option.label}</Typography>
                      </Stack>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <LocalizationProvider dateAdapter={AdapterDayjs}>
                <DateTimePicker
                  label="Poll Expiration (Optional)"
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
                  slotProps={{
                    textField: {
                      fullWidth: true,
                    },
                  }}
                />
              </LocalizationProvider>
            </Grid>
          </Grid>
        </Box>

        <Box>
          <Typography variant="h6" sx={{ mb: 3 }}>
            Advanced Settings
          </Typography>
          <TextField
            type="number"
            label="Proof of Work Difficulty (Optional)"
            placeholder="Enter difficulty level"
            value={poW || ""}
            onChange={(e) => setPoW(Number(e.target.value))}
            fullWidth
          />
        </Box>


        <Box sx={{ pt: 2 }}>
          <Box display="flex" flexDirection="column" gap={2}>
            <Button type="submit" variant="contained" disabled={isSubmitting}>
              {isSubmitting ? "Creating Poll..." : "Create Poll"}
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
                <PollPreview pollEvent={previewEvent} />
              </Box>
            </Collapse>
          </Box>
        </Box>
      </Stack>
      {publishResult && (
        <PublishDiagnosticModal
          open={diagnosticOpen}
          onClose={() => {
            setDiagnosticOpen(false);
            if (publishResult.ok) {
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
