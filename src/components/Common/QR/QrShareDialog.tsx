import React, { useEffect, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
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
}: QrShareDialogProps) {
  const { showNotification } = useNotification();
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  const copy = async () => {
    try {
      await copyToClipboard(value);
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
    try {
      const data: ShareData = value.startsWith("http")
        ? { title, text: subtitle, url: value }
        : { title, text: value };
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
          <QRCodeSVG value={value} size={232} level="M" includeMargin={false} />
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
          {displayValue || value}
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
