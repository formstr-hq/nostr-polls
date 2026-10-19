import React, { useState, useMemo } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Chip,
  Typography,
} from "@mui/material";
import { Event, nip19 } from "nostr-tools";
import { useRelays } from "../../../hooks/useRelays";
import { NOSTR_EVENT_KINDS } from "../../../constants/nostr";
import { Notes } from "../../Notes";
import PollResponseForm from "../../PollResponse/PollResponseForm";
import NoteTemplateForm from "../../EventCreator/NoteTemplateForm";
import PollTemplateForm from "../../EventCreator/PollTemplateForm";
import { useBackClose } from "../../../hooks/useBackClose";
import { usePublishDiagnostic } from "../../../hooks/usePublishDiagnostic";
import { PublishDiagnosticModal } from "../PublishDiagnosticModal";

interface QuotePostDialogProps {
  open: boolean;
  onClose: () => void;
  event: Event;
}

const QuotePostDialog: React.FC<QuotePostDialogProps> = ({ open, onClose, event }) => {
  const [mode, setMode] = useState<"note" | "poll">("note");
  const [content, setContent] = useState("");
  const { relays } = useRelays();
  useBackClose(open, onClose);
  const { result: publishResult, open: diagOpen, setOpen: setDiagOpen, title: diagTitle, openModal, retry } = usePublishDiagnostic();

  const neventId = useMemo(() => {
    if (!event.id || event.id.length !== 64 || !/^[0-9a-f]+$/i.test(event.id)) return null;
    try {
      return nip19.neventEncode({ id: event.id, relays: relays.slice(0, 2), kind: event.kind });
    } catch { return null; }
  }, [event.id, event.kind, relays]);

  const handleClose = () => {
    setContent("");
    setMode("note");
    onClose();
  };

  return (
    <>
    {publishResult && (
      <PublishDiagnosticModal
        open={diagOpen}
        onClose={() => {
          setDiagOpen(false);
          if (publishResult.ok) handleClose();
        }}
        title={diagTitle}
        entries={publishResult.relayResults}
        onRetry={retry}
      />
    )}
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Quote {event.kind === NOSTR_EVENT_KINDS.POLL ? "Poll" : "Post"}
      </DialogTitle>
      <DialogContent>
        {/* Mode chips — same style as Notes / Conversations pills */}
        <Box display="flex" gap={1} sx={{ mb: 2 }}>
          <Chip
            label="as Note"
            size="small"
            variant={mode === "note" ? "filled" : "outlined"}
            color={mode === "note" ? "primary" : "default"}
            onClick={() => setMode("note")}
          />
          <Chip
            label="as Poll"
            size="small"
            variant={mode === "poll" ? "filled" : "outlined"}
            color={mode === "poll" ? "primary" : "default"}
            onClick={() => setMode("poll")}
          />
        </Box>

        {/* Quoted event preview */}
        {neventId ? (
          <Box
            sx={{
              mb: 2,
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
              overflow: "hidden",
              opacity: 0.85,
              pointerEvents: "none",
              // Notes/PollResponseForm set pointerEvents:auto on their own card;
              // a quote preview must be inert all the way down.
              "& *": { pointerEvents: "none !important" },
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ px: 1.5, pt: 1, display: "block" }}>
              Quoting:
            </Typography>
            {event.kind === NOSTR_EVENT_KINDS.POLL ? (
              <PollResponseForm pollEvent={event} hideActions />
            ) : (
              <Notes event={event} hideActions />
            )}
          </Box>
        ) : (
          <Typography color="error" sx={{ mb: 2 }}>Unable to load post preview</Typography>
        )}

        {/* Creator forms — fully reused, no duplication */}
        {mode === "note" ? (
          <NoteTemplateForm
            eventContent={content}
            setEventContent={setContent}
            quotedEvent={event}
            dockSticky={false}
            onPublishResult={(ev, result) => openModal(ev, result, "Quote publish results")}
          />
        ) : (
          <PollTemplateForm
            eventContent={content}
            setEventContent={setContent}
            quotedEvent={event}
            dockSticky={false}
            onPublishResult={(ev, result) => openModal(ev, result, "Quote publish results")}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
    </>
  );
};

export default QuotePostDialog;
