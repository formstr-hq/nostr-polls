import React from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Tooltip,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import SyncIcon from "@mui/icons-material/Sync";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import { dataLayer, type Diagnostics, type RelayHealth } from "@formstr/local-relay";

// IndexedDB database the worker persists the shared event store to. Matches
// `new IndexedDBStorage("shared")` in the worker entry (`pollerama-local-relay`
// prefix + namespace). Deleting it clears the on-disk cache.
const CACHE_DB_NAME = "pollerama-local-relay:shared";

const SectionHeader: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography
    variant="subtitle2"
    sx={{
      mb: 1,
      fontWeight: 600,
      color: "text.secondary",
      textTransform: "uppercase",
      fontSize: "0.7rem",
      letterSpacing: "0.08em",
    }}
  >
    {children}
  </Typography>
);

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.5 }}>
    <Typography variant="body2" color="text.secondary">
      {label}
    </Typography>
    <Typography variant="body2" sx={{ fontWeight: 600 }}>
      {value}
    </Typography>
  </Box>
);

// Friendly labels for the kinds the app cares about; anything else shows as the
// raw number so the cache breakdown is still legible.
const KIND_LABELS: Record<number, string> = {
  0: "Profiles",
  1: "Notes",
  3: "Contacts",
  6: "Reposts",
  7: "Reactions",
  1059: "Gift wraps",
  1068: "Polls",
  1018: "Poll responses",
  10002: "Relay lists",
  30023: "Articles",
};

const hostOf = (relay: string): string => {
  try {
    return new URL(relay).host;
  } catch {
    return relay;
  }
};

const relayStatusLabel = (r: RelayHealth): string => {
  if (r.connected) return "connected";
  if (r.connecting) return "connecting";
  if (r.reconnecting) return "reconnecting";
  return "offline";
};

const relayStatusColor = (r: RelayHealth): "success" | "warning" | "default" => {
  if (r.connected) return "success";
  if (r.connecting || r.reconnecting) return "warning";
  return "default";
};

export const NetworkSettings: React.FC = () => {
  const [diag, setDiag] = React.useState<Diagnostics | null>(null);
  const [error, setError] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [clearing, setClearing] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const d = await dataLayer.diagnostics();
      setDiag(d);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  const handleReconnect = () => {
    // The app can't open sockets directly; resume() nudges the worker to
    // re-establish its connections from the standing interests.
    dataLayer.resume();
    setTimeout(refresh, 600);
  };

  const handleClearCache = async () => {
    const ok = window.confirm(
      "Clear the local event cache? The app will reload and re-fetch from relays. Your keys and settings are not affected."
    );
    if (!ok) return;
    setClearing(true);
    try {
      // The worker holds the DB open, so the delete only completes once this page
      // (and its worker) goes away — reloading right after both clears and
      // rebuilds a fresh, hydrated store.
      indexedDB.deleteDatabase(CACHE_DB_NAME);
    } catch {
      // best-effort; reload anyway
    }
    setTimeout(() => window.location.reload(), 250);
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 2 }}>
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">
          Reading worker state…
        </Typography>
      </Box>
    );
  }

  if (error || !diag) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Couldn't read the relay worker's state. It may still be starting up.
        </Typography>
        <Button size="small" startIcon={<RefreshIcon />} onClick={refresh}>
          Retry
        </Button>
      </Box>
    );
  }

  const topKinds = Object.entries(diag.cache.eventsByKind)
    .map(([k, n]) => ({ kind: Number(k), count: n }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const syncingInterests = diag.interests.filter((i) => i.sync).length;

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        p: 2,
        bgcolor: "background.paper",
        color: "text.primary",
      }}
    >
      {/* Actions */}
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={refresh}>
          Refresh
        </Button>
        <Button size="small" variant="outlined" startIcon={<SyncIcon />} onClick={handleReconnect}>
          Reconnect
        </Button>
        <Button
          size="small"
          variant="outlined"
          color="error"
          startIcon={clearing ? <CircularProgress size={14} /> : <DeleteSweepIcon />}
          onClick={handleClearCache}
          disabled={clearing}
        >
          Clear cache
        </Button>
      </Box>

      {/* Lifecycle / connections */}
      <Box>
        <SectionHeader>Network</SectionHeader>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 1 }}>
          <Chip
            size="small"
            label={diag.paused ? "Paused" : "Active"}
            color={diag.paused ? "warning" : "success"}
            variant={diag.paused ? "filled" : "outlined"}
          />
          <Chip size="small" variant="outlined" label={`${diag.connections.total} connected`} />
        </Box>
        <Stat label="User relays" value={diag.connections.user} />
        <Stat label="Outbox relays" value={diag.connections.outbox} />
        <Stat label="Gossip relays (discovered)" value={diag.connections.gossip} />
        {diag.paused && (
          <Typography variant="caption" color="warning.main" sx={{ display: "block", mt: 0.5 }}>
            The worker is paused while the app is in the foreground — tap Reconnect.
          </Typography>
        )}
      </Box>

      <Divider />

      {/* Relay health */}
      <Box>
        <SectionHeader>Relays ({diag.relays.length})</SectionHeader>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
          {diag.relays.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No relays configured.
            </Typography>
          )}
          {diag.relays.map((r) => (
            <Box
              key={r.relay}
              sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}
            >
              <Typography variant="body2" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {hostOf(r.relay)}
              </Typography>
              <Box sx={{ display: "flex", gap: 0.5, flexShrink: 0 }}>
                {r.gossip && (
                  <Tooltip title="Discovered relay (gossip pool) — read/discovery only">
                    <Chip size="small" variant="outlined" label="gossip" sx={{ height: 20 }} />
                  </Tooltip>
                )}
                <Chip
                  size="small"
                  label={relayStatusLabel(r)}
                  color={relayStatusColor(r)}
                  variant={r.connected ? "filled" : "outlined"}
                  sx={{ height: 20 }}
                />
              </Box>
            </Box>
          ))}
        </Box>
      </Box>

      <Divider />

      {/* Subscriptions */}
      <Box>
        <SectionHeader>Subscriptions</SectionHeader>
        <Stat label="Declared interests" value={diag.interests.length} />
        <Stat label="…of which syncing" value={syncingInterests} />
        <Stat label="Upstream subscriptions" value={diag.upstream.length} />
        <Stat
          label="Enrichment queue"
          value={`${diag.enrichment.queuedIds} ids · ${diag.enrichment.queuedAuthors} authors`}
        />
        {diag.interests.length === 0 && (
          <Typography variant="caption" color="warning.main" sx={{ display: "block", mt: 0.5 }}>
            No interests declared while the app is open — the worker may have
            restarted. Reopen the screen or reconnect to re-declare.
          </Typography>
        )}
      </Box>

      <Divider />

      {/* Cache */}
      <Box>
        <SectionHeader>Cache</SectionHeader>
        <Stat label="Stored events" value={diag.cache.totalEvents.toLocaleString()} />
        <Stat label="Distinct authors" value={diag.cache.totalAuthors.toLocaleString()} />
        {topKinds.length > 0 && (
          <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mt: 1 }}>
            {topKinds.map(({ kind, count }) => (
              <Chip
                key={kind}
                size="small"
                variant="outlined"
                label={`${KIND_LABELS[kind] ?? `kind ${kind}`}: ${count.toLocaleString()}`}
              />
            ))}
          </Box>
        )}
      </Box>

      {/* Gossip pool detail */}
      {diag.gossipRelays.length > 0 && (
        <>
          <Divider />
          <Box>
            <SectionHeader>Discovered relays ({diag.gossipRelays.length})</SectionHeader>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              Relay hints picked up from references (e.g. notes shared in DMs). Used
              for reads only — never to publish.
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
              {diag.gossipRelays.map((r) => (
                <Typography key={r} variant="caption" color="text.secondary" noWrap>
                  {hostOf(r)}
                </Typography>
              ))}
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
};
