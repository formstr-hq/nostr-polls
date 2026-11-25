import React, { useEffect, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/CloseRounded";
import ContentCopyIcon from "@mui/icons-material/ContentCopyRounded";
import ShareIcon from "@mui/icons-material/ShareRounded";
import { QRCodeSVG } from "qrcode.react";
import { copyToClipboard } from "../../../utils/common";
import { useNotification } from "../../../contexts/notification-context";

interface QrShareDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Encoded into the QR. Web URLs are shared as links, other URIs as text. */
  value: string;
  /** Human-readable value shown under the QR (defaults to `value`). */
  displayValue?: string;
  /** Optional second payload, e.g. a web URL next to a NIP-21 profile URI. */
  alternateValue?: string;
  primaryLabel?: string;
  alternateLabel?: string;
}

/**
 * One QR dialog for profiles and payment targets: native share when the
 * platform exposes it, copy-to-clipboard everywhere else.
 */
export default function QrShareDialog({
  open,
  onClose,
  title,
  subtitle,
  value,
  displayValue,
  alternateValue,
  primaryLabel = "Nostr",
  alternateLabel = "Web link",
}: QrShareDialogProps) {
  const { showNotification } = useNotification();
  const [copied, setCopied] = useState(false);
  const [showAlternate, setShowAlternate] = useState(false);
  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  useEffect(() => {
    if (!open) {
      setCopied(false);
      setShowAlternate(false);
    }
  }, [open]);

  const selectedValue = showAlternate && alternateValue ? alternateValue : value;
  const selectedDisplay =
    showAlternate && alternateValue ? alternateValue : displayValue || value;

  const copy = async () => {
    try {
      await copyToClipboard(selectedValue);
      setCopied(true);
      showNotification("Copied to clipboard", "success");
    } catch {
      showNotification("Couldn't copy — long-press to select it instead.", "error");
    }
  };

  const share = async () => {
    if (!canShare) {
      await copy();
      return;
    }
    // When both payloads exist, share the web link: it opens in the app via
    // App Links and is still readable by people without a Nostr client.
    const shareValue = alternateValue || selectedValue;
    try {
      const data: ShareData = shareValue.startsWith("http")
        ? { title, text: subtitle, url: shareValue }
        : { title, text: shareValue };
      await navigator.share(data);
    } catch {
      // User cancelled the share sheet — leave the dialog as-is.
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" noWrap>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary" component="div">
              {subtitle}
            </Typography>
          )}
        </Box>
        <IconButton size="small" onClick={onClose} aria-label="Close QR code">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        {alternateValue && (
          <ToggleButtonGroup
            size="small"
            exclusive
            fullWidth
            value={showAlternate ? "alternate" : "primary"}
            onChange={(_, next) => {
              if (!next) return;
              setShowAlternate(next === "alternate");
              setCopied(false);
            }}
            sx={{ mb: 2 }}
          >
            <ToggleButton value="primary">{primaryLabel}</ToggleButton>
            <ToggleButton value="alternate">{alternateLabel}</ToggleButton>
          </ToggleButtonGroup>
        )}

        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            p: 2,
            bgcolor: "common.white",
            borderRadius: "20px",
            mb: 2,
          }}
        >
          <QRCodeSVG value={selectedValue} size={232} level="M" includeMargin={false} />
        </Box>
        <Typography
          variant="caption"
          color="text.secondary"
          component="div"
          sx={{
            fontFamily: "monospace",
            wordBreak: "break-all",
            textAlign: "center",
            px: 1,
          }}
        >
          {selectedDisplay}
        </Typography>
      </DialogContent>

      <DialogActions sx={{ px: 2, pb: 2, gap: 1 }}>
        <Tooltip title="Copy">
          <Button
            variant="outlined"
            size="small"
            startIcon={<ContentCopyIcon />}
            onClick={copy}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </Tooltip>
        <Button
          variant="contained"
          size="small"
          startIcon={<ShareIcon />}
          onClick={share}
          disableElevation
        >
          Share
        </Button>
      </DialogActions>
    </Dialog>
  );
}
