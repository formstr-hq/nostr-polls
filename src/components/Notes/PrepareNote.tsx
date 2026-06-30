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
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { useNavigate } from "react-router-dom";
import { dataLayer } from "@formstr/local-relay";
import { EventPointer } from "nostr-tools/lib/types/nip19";
import PollResponseForm from "../PollResponse/PollResponseForm";
import { useRelayRefresh } from "../../dataLayer/hooks";
import {
  MAX_NOTE_DEPTH,
  NoteDepthContext,
  useNoteDepth,
} from "../../contexts/note-depth-context";

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
  const depth = useNoteDepth();
  const navigate = useNavigate();

  // Once we're nested too deep, embedding the full note would render its own
  // references (and theirs…) into an unbounded tree. Show a clickable preview
  // that opens the note in its own view instead of silently rendering nothing.
  const tooDeep = depth >= MAX_NOTE_DEPTH;
  const openInOwnView = () => navigate(`/note/${neventId}`);

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
    if (tooDeep) {
      const preview = (event.content || "").replace(/\s+/g, " ").trim();
      return (
        <Box
          onClick={openInOwnView}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openInOwnView();
            }
          }}
          sx={{
            mt: 0.5,
            p: 1.5,
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            cursor: "pointer",
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}>
            <OpenInNewIcon sx={{ fontSize: 14 }} color="primary" />
            <Typography variant="caption" color="primary">
              Open referenced note in its own view
            </Typography>
          </Box>
          {preview && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {preview}
            </Typography>
          )}
        </Box>
      );
    }
    const rendered =
      event.kind === 1068 ? (
        <PollResponseForm pollEvent={event} />
      ) : (
        <Notes event={event} />
      );
    // Anything this note references renders one level deeper.
    return (
      <NoteDepthContext.Provider value={depth + 1}>
        {rendered}
      </NoteDepthContext.Provider>
    );
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
