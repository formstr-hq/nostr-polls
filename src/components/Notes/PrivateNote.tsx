import { useEffect, useRef, useState } from "react";
import { useRelays } from "../../hooks/useRelays";
import { Event, nip19 } from "nostr-tools";
import { Notes } from ".";
import { Box, Button, CircularProgress, Typography, Alert } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import { nostrRuntime } from "../../singletons";
import { EventPointer } from "nostr-tools/lib/types/nip19";
import { getRelaysForAuthors, getOutboxRelays } from "../../nostr/OutboxService";
import { defaultRelays } from "../../nostr";
import { decryptPrivateNote, viewKeyFromHex } from "../../nostr/privateNote";

interface PrivateNoteProps {
  neventId: string;
}

type State =
  | { status: "loading" }
  | { status: "no-key" }
  | { status: "bad-key"; reason: string }
  | { status: "not-found" }
  | { status: "decrypt-failed" }
  | { status: "ready"; event: Event };

// Pull the viewkey out of the URL fragment: #k=<hex>
function readKeyFromFragment(): { hex: string } | null {
  const raw = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!raw) return null;
  for (const part of raw.split("&")) {
    const [k, v] = part.split("=");
    if (k === "k" && v) return { hex: v };
  }
  return null;
}

export const PrivateNote: React.FC<PrivateNoteProps> = ({ neventId }) => {
  const { relays } = useRelays();
  const [state, setState] = useState<State>({ status: "loading" });
  const [retry, setRetry] = useState(0);

  // Refs so the load function reads the latest values without becoming a new
  // identity every time relays update — that was causing a re-fetch + re-decrypt
  // loop and forcing <Notes> to re-mount on every relay-context tick.
  const relaysRef = useRef(relays);
  const stateRef = useRef(state);
  useEffect(() => { relaysRef.current = relays; }, [relays]);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setState({ status: "loading" });

      const fragment = readKeyFromFragment();
      if (!fragment) {
        if (!cancelled) setState({ status: "no-key" });
        return;
      }

      let key: Uint8Array;
      try {
        key = viewKeyFromHex(fragment.hex);
      } catch (e) {
        if (!cancelled) setState({ status: "bad-key", reason: (e as Error).message });
        return;
      }

      let decoded: EventPointer;
      try {
        decoded = nip19.decode(neventId).data as EventPointer;
      } catch {
        if (!cancelled) setState({ status: "bad-key", reason: "Invalid note reference in link" });
        return;
      }

      let relaysToUse = Array.from(
        new Set([...relaysRef.current, ...defaultRelays, ...(decoded.relays || [])])
      );
      if (decoded.author) {
        relaysToUse = getRelaysForAuthors(relaysToUse, [decoded.author]);
      }

      let event: Event | null = null;
      try {
        const phase1 = await nostrRuntime.fetchWithDiagnostics(relaysToUse, decoded.id);
        event = phase1.event;
        if (!event && decoded.author) {
          const outbox = await getOutboxRelays(decoded.author);
          const extra = outbox.filter((r) => !relaysToUse.includes(r));
          if (extra.length > 0) {
            const phase2 = await nostrRuntime.fetchWithDiagnostics(extra, decoded.id);
            event = phase2.event;
          }
        }
      } catch (e) {
        console.error("Error fetching private note:", e);
      }

      if (cancelled) return;

      if (!event) {
        setState({ status: "not-found" });
        return;
      }

      let plaintext: string;
      try {
        plaintext = decryptPrivateNote(event.content, key);
      } catch (e) {
        console.error("Decrypt failed:", e);
        setState({ status: "decrypt-failed" });
        return;
      }

      setState({ status: "ready", event: { ...event, content: plaintext } });
    };
    load();
    return () => { cancelled = true; };
  }, [neventId, retry]);

  // Auto-retry only if we couldn't find the note on the previous attempt and
  // relays have just become available/updated. Once we have it (or the key is
  // wrong, or the link is malformed) relay changes are irrelevant.
  useEffect(() => {
    if (stateRef.current.status === "not-found") {
      setRetry((c) => c + 1);
    }
  }, [relays]);

  if (state.status === "ready") {
    return (
      <Box>
        <Box sx={{ m: 1, p: 1, display: "flex", alignItems: "center", gap: 1 }}>
          <LockOpenIcon fontSize="small" color="primary" />
          <Typography variant="caption" color="text.secondary">
            Private note — only people with this link can read it.
          </Typography>
        </Box>
        <Notes event={state.event} />
      </Box>
    );
  }

  if (state.status === "loading") {
    return (
      <Box display="flex" alignItems="center" gap={1} p={2}>
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">
          Decrypting private note…
        </Typography>
      </Box>
    );
  }

  let title = "Couldn't open this note";
  let body = "";
  switch (state.status) {
    case "no-key":
      title = "Missing key";
      body =
        "This link doesn't include a decryption key. The key lives after the '#' in the URL — make sure it wasn't cut off when the link was shared.";
      break;
    case "bad-key":
      title = "Invalid link";
      body = state.reason;
      break;
    case "not-found":
      title = "Note not found";
      body =
        "We couldn't fetch this note from any of your relays. The author may have posted it to different relays — try again, or ask them for a fresh link.";
      break;
    case "decrypt-failed":
      title = "Key doesn't match this note";
      body =
        "The note was found but the key in this link can't decrypt it. The link may have been edited, or the note was re-encrypted with a different key.";
      break;
  }

  return (
    <Box sx={{ p: 3, maxWidth: 600, mx: "auto" }}>
      <Alert severity="warning" sx={{ mb: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          {title}
        </Typography>
        <Typography variant="body2">{body}</Typography>
      </Alert>
      {(state.status === "not-found" || state.status === "decrypt-failed") && (
        <Button startIcon={<RefreshIcon />} onClick={() => setRetry((c) => c + 1)}>
          Retry
        </Button>
      )}
    </Box>
  );
};
