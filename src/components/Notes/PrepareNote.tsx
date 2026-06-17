import { useEffect, useState, useCallback } from "react";
import { useRelays } from "../../hooks/useRelays";
import { Event, nip19 } from "nostr-tools";
import { Notes } from ".";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Typography,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import RefreshIcon from "@mui/icons-material/Refresh";
import { nostrRuntime } from "../../singletons";
import { FetchDiagnostics, RelayFetchResult } from "../../nostrRuntime/types";
import { EventPointer } from "nostr-tools/lib/types/nip19";
import PollResponseForm from "../PollResponse/PollResponseForm";
import { getRelaysForAuthors, getOutboxRelays } from "../../nostr/OutboxService";
import { defaultRelays } from "../../nostr";

interface PrepareNoteInterface {
  neventId: string;
}

interface DiagnosticState {
  phase1: FetchDiagnostics | null;
  phase2: FetchDiagnostics | null; // gossip relay retry, if any
}

// Merge two phases into a single flat relay result list, deduplicating by relay URL
function mergeResults(d: DiagnosticState): RelayFetchResult[] {
  const map = new Map<string, RelayFetchResult>();
  for (const result of [
    ...(d.phase1?.relayResults ?? []),
    ...(d.phase2?.relayResults ?? []),
  ]) {
    // prefer eosed=true if either phase got EOSE from this relay
    const existing = map.get(result.relay);
    map.set(result.relay, {
      relay: result.relay,
      eosed: existing ? existing.eosed || result.eosed : result.eosed,
    });
  }
  return Array.from(map.values());
}

function totalDuration(d: DiagnosticState): number {
  return (d.phase1?.durationMs ?? 0) + (d.phase2?.durationMs ?? 0);
}

function RelayDiagnosticPanel({ diag }: { diag: DiagnosticState }) {
  const [open, setOpen] = useState(false);
  const results = mergeResults(diag);
  const eosedCount = results.filter((r) => r.eosed).length;
  const durationSec = (totalDuration(diag) / 1000).toFixed(1);

  return (
    <Box sx={{ mt: 1 }}>
      <Button
        size="small"
        variant="text"
        onClick={() => setOpen((v) => !v)}
        endIcon={open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
        sx={{ textTransform: "none", color: "text.secondary", p: 0 }}
      >
        {results.length} relay{results.length !== 1 ? "s" : ""} tried &bull;{" "}
        {eosedCount} confirmed miss &bull; {durationSec}s
      </Button>

      <Collapse in={open}>
        <Box
          sx={{
            mt: 1,
            display: "flex",
            flexDirection: "column",
            gap: 0.5,
            pl: 1,
            borderLeft: "2px solid",
            borderColor: "divider",
          }}
        >
          {results.map((r) => (
            <Box
              key={r.relay}
              sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
            >
              {r.eosed ? (
                <CheckCircleOutlineIcon
                  fontSize="small"
                  sx={{ color: "text.disabled", flexShrink: 0 }}
                />
              ) : (
                <HelpOutlineIcon
                  fontSize="small"
                  sx={{ color: "warning.main", flexShrink: 0 }}
                />
              )}
              <Typography
                variant="caption"
                sx={{
                  fontFamily: "monospace",
                  wordBreak: "break-all",
                  color: "text.secondary",
                }}
              >
                {r.relay}
              </Typography>
              <Chip
                label={r.eosed ? "no match" : "timeout"}
                size="small"
                variant="outlined"
                color={r.eosed ? "default" : "warning"}
                sx={{ ml: "auto", flexShrink: 0, height: 18, fontSize: "0.65rem" }}
              />
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

export const PrepareNote: React.FC<PrepareNoteInterface> = ({ neventId }) => {
  const { relays } = useRelays();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [diag, setDiag] = useState<DiagnosticState | null>(null);

  const fetchEvent = useCallback(async () => {
    setLoading(true);
    setEvent(null);
    setDiag(null);
    try {
      const decoded = nip19.decode(neventId).data as EventPointer;
      const eventId = decoded?.id;
      // A note/naddr reference (or malformed input) may not carry an event id.
      // Without one there's nothing to fetch and the relay filter would be
      // invalid ({"ids":[null]}), which relays reject instantly — so bail to the
      // error state rather than firing a doomed request.
      if (!eventId) {
        setLoading(false);
        return;
      }

      // Relay set: user relays + default relays + nevent hints + cached outbox
      // relays for the author. Always include defaultRelays so notes not on the
      // user's custom relays can still be found.
      let relaysToUse = Array.from(
        new Set([...relays, ...defaultRelays, ...(decoded.relays || [])])
      );
      if (decoded.author) {
        relaysToUse = getRelaysForAuthors(relaysToUse, [decoded.author]);
      }

      // Primary path: fetch through the shared pool. It reuses already-open,
      // healthy connections and the event cache, so it's far more reliable than
      // opening a burst of fresh standalone WebSockets. Most references resolve
      // here; the diagnostic prober below is only a fallback for genuine misses.
      const pooled = await nostrRuntime.querySync(relaysToUse, {
        ids: [eventId],
        limit: 1,
      });
      const pooledHit = pooled.find((e) => e.id === eventId);
      if (pooledHit) {
        setEvent(pooledHit);
        return;
      }

      // Phase 1: per-relay diagnostic probe so the error state can explain which
      // relays were tried and whether they confirmed a miss (EOSE) or timed out.
      const phase1 = await nostrRuntime.fetchWithDiagnostics(relaysToUse, eventId);

      if (phase1.event) {
        setEvent(phase1.event);
        return;
      }

      // Phase 2: fetch author's outbox from network (cold start) and retry on
      // any newly discovered relays not already tried in phase 1
      let phase2: FetchDiagnostics | null = null;
      if (decoded.author) {
        const outboxRelays = await getOutboxRelays(decoded.author);
        const tried = new Set(relaysToUse);
        const gossipRelays = outboxRelays.filter((r) => !tried.has(r));
        if (gossipRelays.length > 0) {
          phase2 = await nostrRuntime.fetchWithDiagnostics(gossipRelays, eventId);
        }
      }

      setDiag({ phase1, phase2 });
      setEvent(phase2?.event ?? null);
    } catch (error) {
      console.error("Error fetching event:", error);
    } finally {
      setLoading(false);
    }
  }, [neventId, relays]);

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

      {diag && <RelayDiagnosticPanel diag={diag} />}

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
