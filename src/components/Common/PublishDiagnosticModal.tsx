import React, { useState, useEffect } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import TimerOffIcon from "@mui/icons-material/TimerOff";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import ReplayIcon from "@mui/icons-material/Replay";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useBackClose } from "../../hooks/useBackClose";
import useMediaQuery from "@mui/material/useMediaQuery";

export type DiagnosticRelayStatus = "accepted" | "sent" | "rejected" | "failed" | "timeout" | "pending";

export interface DiagnosticEntry {
  relay: string;
  status: DiagnosticRelayStatus;
  message?: string;
  latencyMs?: number;
}

interface PublishDiagnosticModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  entries: DiagnosticEntry[];
  /** Called with a relay URL to retry just that relay, or undefined to retry all failed. */
  onRetry?: (relay?: string) => Promise<DiagnosticEntry[]>;
  /** Optional content rendered above the relay table (e.g. a private-note share link). */
  headerContent?: React.ReactNode;
}

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function StatusChip({ status }: { status: DiagnosticRelayStatus }) {
  if (status === "accepted" || status === "sent") {
    return (
      <Chip
        icon={<CheckCircleOutlineIcon />}
        label={status}
        size="small"
        color="success"
        variant="outlined"
        sx={{ fontSize: "0.7rem", height: 22 }}
      />
    );
  }
  if (status === "timeout") {
    return (
      <Chip
        icon={<TimerOffIcon />}
        label="timeout"
        size="small"
        color="warning"
        variant="outlined"
        sx={{ fontSize: "0.7rem", height: 22 }}
      />
    );
  }
  if (status === "pending") {
    return (
      <Chip
        icon={<HourglassEmptyIcon />}
        label="pending"
        size="small"
        variant="outlined"
        sx={{ fontSize: "0.7rem", height: 22 }}
      />
    );
  }
  return (
    <Chip
      icon={<ErrorOutlineIcon />}
      label={status}
      size="small"
      color="error"
      variant="outlined"
      sx={{ fontSize: "0.7rem", height: 22 }}
    />
  );
}

export const PublishDiagnosticModal: React.FC<PublishDiagnosticModalProps> = ({
  open,
  onClose,
  title = "Relay publish results",
  entries,
  onRetry,
  headerContent,
}) => {
  useBackClose(open, onClose);
  const isMobile = useMediaQuery("(max-width:600px)");
  const [currentEntries, setCurrentEntries] = useState<DiagnosticEntry[]>(entries);
  // Set of relay URLs currently being retried
  const [retryingRelays, setRetryingRelays] = useState<Set<string>>(new Set());
  // On mobile, track which rows have their message expanded
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    setCurrentEntries(entries);
  }, [entries]);

  const isRetrying = retryingRelays.size > 0;

  const handleRetry = async (relay?: string) => {
    if (!onRetry) return;
    const targets = relay
      ? [relay]
      : currentEntries.filter((e) => e.status !== "accepted" && e.status !== "sent").map((e) => e.relay);
    if (targets.length === 0) return;

    setRetryingRelays((prev) => new Set(Array.from(prev).concat(targets)));
    try {
      const updated = await onRetry(relay);
      setCurrentEntries(updated);
    } finally {
      setRetryingRelays((prev) => {
        const next = new Set(prev);
        targets.forEach((r) => next.delete(r));
        return next;
      });
    }
  };

  const toggleExpanded = (relay: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(relay) ? next.delete(relay) : next.add(relay);
      return next;
    });
  };

  const accepted = currentEntries.filter((e) => e.status === "accepted" || e.status === "sent").length;
  const rejected = currentEntries.filter((e) => e.status === "rejected").length;
  const connFailed = currentEntries.filter((e) => e.status === "failed").length;
  const timedOut = currentEntries.filter((e) => e.status === "timeout").length;
  const retryable = currentEntries.filter((e) => e.status !== "accepted" && e.status !== "sent").length;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="h6">{title}</Typography>
          <Box sx={{ display: "flex", gap: 0.5 }}>
            {accepted > 0 && <Chip label={`${accepted} accepted`} size="small" color="success" />}
            {timedOut > 0 && <Chip label={`${timedOut} timeout`} size="small" color="warning" />}
            {rejected > 0 && <Chip label={`${rejected} rejected`} size="small" color="error" />}
            {connFailed > 0 && <Chip label={`${connFailed} failed`} size="small" color="error" />}
          </Box>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ px: isMobile ? 1 : 2 }}>
        {headerContent && <Box sx={{ mb: 2 }}>{headerContent}</Box>}
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem" }}>Relay</TableCell>
              {isMobile ? (
                // Mobile: single merged Status column (includes retry button inline)
                <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem", width: 120 }}>Status</TableCell>
              ) : (
                <>
                  <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem", width: 110 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem", width: 70 }}>Time</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem" }}>Reason</TableCell>
                  {onRetry && <TableCell sx={{ width: 36 }} />}
                </>
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {currentEntries.map((e) => {
              const isFailed = e.status !== "accepted" && e.status !== "sent";
              const isRowRetrying = retryingRelays.has(e.relay);
              const isExpanded = expandedRows.has(e.relay);

              if (isMobile) {
                return (
                  <React.Fragment key={e.relay}>
                    <TableRow>
                      <TableCell sx={{ fontFamily: "monospace", fontSize: "0.7rem", py: 0.75 }}>
                        {hostname(e.relay)}
                      </TableCell>
                      <TableCell sx={{ py: 0.75 }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                          {isRowRetrying ? (
                            <CircularProgress size={16} />
                          ) : (
                            <StatusChip status={e.status} />
                          )}
                          {/* Retry button merged into status column */}
                          {onRetry && isFailed && !isRowRetrying && (
                            <Tooltip title="Retry">
                              <span>
                                <IconButton
                                  size="small"
                                  disabled={isRetrying}
                                  onClick={() => handleRetry(e.relay)}
                                  sx={{ p: 0.25 }}
                                >
                                  <ReplayIcon sx={{ fontSize: 14 }} />
                                </IconButton>
                              </span>
                            </Tooltip>
                          )}
                          {/* Expand message */}
                          {e.message && (
                            <IconButton
                              size="small"
                              onClick={() => toggleExpanded(e.relay)}
                              sx={{
                                p: 0.25,
                                transform: isExpanded ? "rotate(180deg)" : "none",
                                transition: "transform 0.2s",
                              }}
                            >
                              <ExpandMoreIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                          )}
                        </Box>
                        {e.message && (
                          <Collapse in={isExpanded}>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ display: "block", mt: 0.5, fontSize: "0.65rem", wordBreak: "break-word" }}
                            >
                              {e.message}
                            </Typography>
                          </Collapse>
                        )}
                      </TableCell>
                    </TableRow>
                  </React.Fragment>
                );
              }

              // Desktop: full table
              return (
                <TableRow key={e.relay}>
                  <TableCell sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
                    {hostname(e.relay)}
                  </TableCell>
                  <TableCell>
                    {isRowRetrying ? (
                      <CircularProgress size={16} />
                    ) : (
                      <StatusChip status={e.status} />
                    )}
                  </TableCell>
                  <TableCell sx={{ fontSize: "0.75rem", color: e.latencyMs !== undefined && e.latencyMs > 2000 ? "warning.main" : "text.secondary" }}>
                    {e.latencyMs !== undefined ? (e.latencyMs < 1000 ? `${e.latencyMs}ms` : `${(e.latencyMs / 1000).toFixed(1)}s`) : "—"}
                  </TableCell>
                  <TableCell sx={{ fontSize: "0.75rem", color: "text.secondary" }}>
                    {e.message || "no reason provided"}
                  </TableCell>
                  {onRetry && (
                    <TableCell sx={{ p: 0 }}>
                      {isFailed && (
                        <Tooltip title="Retry this relay">
                          <span>
                            <IconButton
                              size="small"
                              disabled={isRowRetrying || isRetrying}
                              onClick={() => handleRetry(e.relay)}
                            >
                              {isRowRetrying ? <CircularProgress size={14} /> : <ReplayIcon sx={{ fontSize: 16 }} />}
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {timedOut > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
            Timed out after 5 s — relay may be slow, unreachable, or the connection dropped.
          </Typography>
        )}
        {rejected > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
            Rejected relays returned a negative OK response. The reason above is what the relay reported.
          </Typography>
        )}
        {connFailed > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
            Connection failures indicate a network or WebSocket error. Try reconnecting in Settings.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        {onRetry && retryable > 1 && (
          <Button
            onClick={() => handleRetry()}
            color="primary"
            disabled={isRetrying}
            startIcon={isRetrying ? <CircularProgress size={16} /> : undefined}
          >
            {isRetrying ? "Retrying…" : `Retry all ${retryable} failed`}
          </Button>
        )}
        <Button onClick={onClose} disabled={isRetrying}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};
