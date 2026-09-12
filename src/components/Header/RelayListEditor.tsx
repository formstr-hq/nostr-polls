import React, { useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import SyncIcon from "@mui/icons-material/Sync";
import {
  fetchRelayListCached,
  fetchRelayListFresh,
  normalizeRelayUrl,
  parseRelayListEvent,
  publishRelayList,
  type RelayListEntry,
} from "../../nostr/nip65";
import { useUserContext } from "../../hooks/useUserContext";
import { useNotification } from "../../contexts/notification-context";

/**
 * Editor for the user's own NIP-65 relay list (kind 10002).
 *
 * Publishes a replaceable 10002 — the standing observe in dataLayer/bootstrap.ts
 * picks the new event up and re-applies the user's read relay set, so no extra
 * wiring is needed for the change to take effect.
 */
export const RelayListEditor: React.FC = () => {
  const { user } = useUserContext();
  const { showNotification } = useNotification();
  const [entries, setEntries] = useState<RelayListEntry[]>([]);
  const [newUrl, setNewUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (!user?.pubkey) return;
    let cancelled = false;
    // Cached read first (instant), then a fresh network read wins if newer.
    fetchRelayListCached(user.pubkey).then((cached) => {
      if (cancelled) return;
      if (cached) setEntries(parseRelayListEvent(cached));
      setLoading(false);
      fetchRelayListFresh(user.pubkey).then((fresh) => {
        if (cancelled) return;
        if (fresh) setEntries(parseRelayListEvent(fresh));
      });
    });
    return () => {
      cancelled = true;
    };
  }, [user?.pubkey]);

  const addRelay = () => {
    const url = normalizeRelayUrl(newUrl);
    if (!url) return;
    if (entries.some((e) => e.url === url)) {
      showNotification("Relay already in your list.", "warning");
      return;
    }
    setEntries((prev) => [...prev, { url, read: true, write: true }]);
    setNewUrl("");
  };

  const updateEntry = (url: string, patch: Partial<RelayListEntry>) => {
    setEntries((prev) =>
      prev.map((e) => (e.url === url ? { ...e, ...patch } : e))
    );
  };

  const removeEntry = (url: string) => {
    setEntries((prev) => prev.filter((e) => e.url !== url));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await publishRelayList(entries);
      showNotification("Relay list published.", "success");
    } catch (err) {
      showNotification(
        "Failed to publish relay list: " +
          (err instanceof Error ? err.message : String(err)),
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 2 }}>
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">
          Loading your relay list…
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Typography variant="caption" color="text.secondary">
        Your relay list is published as a NIP-65 event (kind 10002) that other
        apps and relays use to find you. Read = where you receive, Write =
        where you publish.
      </Typography>
      {entries.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No relays in your published list yet.
        </Typography>
      )}
      {entries.map((entry) => (
        <Box
          key={entry.url}
          sx={{ display: "flex", alignItems: "center", gap: 1 }}
        >
          <Typography
            variant="body2"
            sx={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {entry.url}
          </Typography>
          <Tooltip title="Read (receive events)">
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Read
              </Typography>
              <Checkbox
                size="small"
                checked={entry.read}
                onChange={(e) =>
                  updateEntry(entry.url, { read: e.target.checked })
                }
              />
            </Box>
          </Tooltip>
          <Tooltip title="Write (publish)">
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Write
              </Typography>
              <Checkbox
                size="small"
                checked={entry.write}
                onChange={(e) =>
                  updateEntry(entry.url, { write: e.target.checked })
                }
              />
            </Box>
          </Tooltip>
          <IconButton
            size="small"
            aria-label="Remove relay"
            onClick={() => removeEntry(entry.url)}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}
      <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
        <TextField
          size="small"
          fullWidth
          placeholder="wss://relay.example.com"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addRelay();
            }
          }}
        />
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={addRelay}
        >
          Add
        </Button>
      </Box>
      <Box sx={{ display: "flex", gap: 1 }}>
        <Button
          size="small"
          variant="contained"
          onClick={handleSave}
          disabled={saving || !user?.pubkey}
          startIcon={saving ? <CircularProgress size={14} /> : undefined}
        >
          {saving ? "Publishing…" : "Save relay list"}
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<SyncIcon />}
          disabled={!user?.pubkey || loading}
          onClick={async () => {
            if (!user?.pubkey) return;
            setLoading(true);
            const fresh = await fetchRelayListFresh(user.pubkey);
            if (fresh) setEntries(parseRelayListEvent(fresh));
            setLoading(false);
          }}
        >
          Reload
        </Button>
      </Box>
    </Box>
  );
};