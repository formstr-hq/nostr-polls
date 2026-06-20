import { useEffect, useState, useCallback } from "react";
import { Event, nip19 } from "nostr-tools";
import { Notes } from ".";
import {
  Box,
  Button,
  CircularProgress,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { dataLayer } from "@formstr/local-relay";
import { EventPointer } from "nostr-tools/lib/types/nip19";
import PollResponseForm from "../PollResponse/PollResponseForm";

interface PrepareNoteInterface {
  neventId: string;
}

export const PrepareNote: React.FC<PrepareNoteInterface> = ({ neventId }) => {
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  const fetchEvent = useCallback(async () => {
    setLoading(true);
    setEvent(null);
    try {
      const decoded = nip19.decode(neventId).data as EventPointer;
      const eventId = decoded?.id;
      // A note/naddr reference (or malformed input) may not carry an event id.
      // Without one there's nothing to fetch, so bail to the error state.
      if (!eventId) {
        setLoading(false);
        return;
      }

      // The worker owns relay selection (user relays, nevent hints, the author's
      // outbox relays) and the event cache, so a single fetch by id resolves the
      // reference — no app-side relay fan-out or per-relay diagnostics.
      const found = await dataLayer.fetchById(eventId);
      setEvent(found ?? null);
    } catch (error) {
      console.error("Error fetching event:", error);
    } finally {
      setLoading(false);
    }
  }, [neventId]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent, retryCount]);

  const handleRetry = () => {
    setRetryCount((c) => c + 1);
  };

  if (event) {
    if (event.kind === 1068) {
      return <PollResponseForm pollEvent={event} />;
    }
    return <Notes event={event} />;
  }

  if (loading) {
    return (
      <Box display="flex" alignItems="center" gap={1} p={2}>
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">
          Loading referenced note...
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="body2" color="text.secondary">
        Could not load referenced note.
      </Typography>

      <Box sx={{ mt: 1.5 }}>
        <Button
          size="small"
          startIcon={<RefreshIcon />}
          onClick={handleRetry}
          disabled={loading}
        >
          Retry
        </Button>
      </Box>
    </Box>
  );
};
