import { useEffect, useState } from "react";
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
import { useRelayRefresh } from "../../dataLayer/hooks";

// How long to wait for a cold reference to arrive from the network before
// showing the "could not load" + retry state. The cache replays instantly; this
// only bounds the upstream fetch.
const RESOLVE_TIMEOUT_MS = 8000;

interface PrepareNoteInterface {
  neventId: string;
}

export const PrepareNote: React.FC<PrepareNoteInterface> = ({ neventId }) => {
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  // Re-attempt resolution once the worker hydrates its store, so a reference that
  // missed on a cold cache resolves without the user tapping Retry.
  const refresh = useRelayRefresh();

  useEffect(() => {
    setLoading(true);
    setEvent(null);

    let pointer: EventPointer | undefined;
    try {
      pointer = nip19.decode(neventId).data as EventPointer;
    } catch (error) {
      console.error("Error decoding referenced note:", error);
    }
    const eventId = pointer?.id;
    // A note/naddr reference (or malformed input) may not carry an event id.
    // Without one there's nothing to fetch, so bail to the error state.
    if (!eventId) {
      setLoading(false);
      return;
    }

    // Relay hints in the nevent point at where the note actually lives — often
    // relays the user isn't subscribed to (e.g. a note shared inside a DM). Feed
    // them to the worker's gossip pool so the by-id read below can resolve the
    // reference from them. Read/discovery only — never a publish target.
    (pointer?.relays ?? []).forEach((relay) => dataLayer.addGossipRelay(relay));

    // fetchById is cache-only and can't fetch a cold reference. A syncing observe
    // on the (author-less) id replays the cache instantly and, on a miss, lets the
    // worker pull it from user relays ∪ the gossip pool. First match wins; the
    // network result arrives after the local EOSE, so a timeout — not EOSE —
    // bounds the wait before we surface the retry affordance.
    let settled = false;
    const handle = dataLayer.observe([{ ids: [eventId], limit: 1 }], {
      onEvent: (e) => {
        settled = true;
        setEvent(e);
        setLoading(false);
        handle.unobserve();
      },
    });

    const timer = setTimeout(() => {
      if (!settled) setLoading(false);
    }, RESOLVE_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
      handle.unobserve();
    };
  }, [neventId, retryCount, refresh]);

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
