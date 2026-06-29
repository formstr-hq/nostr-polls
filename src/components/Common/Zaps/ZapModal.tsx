import { copyToClipboard } from "../../../utils/common";
import React, { useEffect, useState } from "react";
import {
  Box,
  Button,
  Modal,
  TextField,
  Typography,
  IconButton,
  CircularProgress,
  Snackbar,
} from "@mui/material";
import { Close, ContentCopy, OpenInNew } from "@mui/icons-material";
import { QRCodeSVG } from "qrcode.react";
import { styled } from "@mui/system";
import { useBackClose } from "../../../hooks/useBackClose";

interface ZapModalProps {
  open: boolean;
  onClose: () => void;
  onZap: (amount: number) => Promise<string | null>;
  recipientName?: string;
  zapConfirmed?: boolean;
  /** Amount (sats) to preselect when the modal opens — e.g. from a hold-to-zap ramp. */
  initialAmount?: number;
}

const PRESET_AMOUNTS = [21, 100, 500, 1000, 5000];

const ModalBox = styled(Box)(({ theme }) => ({
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  backgroundColor: theme.palette.background.paper,
  borderRadius: 16,
  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
  padding: 24,
  width: "90%",
  maxWidth: 400,
  outline: "none",
}));

const AmountButton = styled(Button)<{ selected?: boolean }>(
  ({ theme, selected }) => ({
    borderRadius: 12,
    padding: "12px 16px",
    minWidth: 70,
    fontWeight: 600,
    fontSize: "1rem",
    backgroundColor: selected
      ? "#FAD13F"
      : theme.palette.mode === "dark"
      ? "rgba(255, 255, 255, 0.1)"
      : "rgba(0, 0, 0, 0.05)",
    color: selected ? "#000" : theme.palette.mode === "dark" ? "#fff" : "#000",
    "&:hover": {
      backgroundColor: selected
        ? "#e6c039"
        : theme.palette.mode === "dark"
        ? "rgba(255, 255, 255, 0.15)"
        : "rgba(0, 0, 0, 0.1)",
    },
  }),
);

const ZapButton = styled(Button)({
  borderRadius: 12,
  padding: "14px 24px",
  fontWeight: 700,
  fontSize: "1.1rem",
  background: "linear-gradient(135deg, #FAD13F 0%, #F7931A 100%)",
  color: "#000",
  "&:hover": {
    background: "linear-gradient(135deg, #e6c039 0%, #e08617 100%)",
  },
  "&:disabled": {
    background: "rgba(128, 128, 128, 0.3)",
    color: "rgba(128, 128, 128, 0.7)",
  },
});

const ActionButton = styled(Button)(({ theme }) => ({
  borderRadius: 10,
  padding: "10px 16px",
  flex: 1,
  fontWeight: 600,
  borderColor:
    theme.palette.mode === "dark" ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.2)",
  color: theme.palette.mode === "dark" ? "#fff" : "#000",
}));

const ZapModal: React.FC<ZapModalProps> = ({
  open,
  onClose,
  onZap,
  recipientName,
  zapConfirmed,
  initialAmount,
}) => {
  const [selectedAmount, setSelectedAmount] = useState<number | null>(100);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [invoice, setInvoice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  useBackClose(open, onClose);

  // When opened with a ramped amount, preselect it: match a preset chip if it
  // lines up, otherwise drop it into the custom field.
  useEffect(() => {
    if (!open) return;
    if (initialAmount && initialAmount > 0) {
      if (PRESET_AMOUNTS.includes(initialAmount)) {
        setSelectedAmount(initialAmount);
        setCustomAmount("");
      } else {
        setSelectedAmount(null);
        setCustomAmount(String(initialAmount));
      }
    } else {
      setSelectedAmount(100);
      setCustomAmount("");
    }
  }, [open, initialAmount]);

  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!zapConfirmed) return;
    const timer = setTimeout(() => onCloseRef.current(), 1500);
    return () => clearTimeout(timer);
  }, [zapConfirmed]);

  const handleClose = () => {
    setSelectedAmount(100);
    setCustomAmount("");
    setInvoice(null);
    setLoading(false);
    onClose();
  };

  const getAmount = (): number => {
    if (customAmount) {
      return parseInt(customAmount, 10) || 0;
    }
    return selectedAmount || 0;
  };

  const handlePresetClick = (amount: number) => {
    setSelectedAmount(amount);
    setCustomAmount("");
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "");
    setCustomAmount(value);
    if (value) {
      setSelectedAmount(null);
    }
  };

  const handleZap = async () => {
    const amount = getAmount();
    if (amount <= 0) return;

    setLoading(true);
    try {
      const pr = await onZap(amount);
      if (pr) {
        setInvoice(pr);
      }
    } catch (error) {
      console.error("Zap failed:", error);
    } finally {
      setLoading(false);
    }
  };

  const copyInvoice = async () => {
    if (invoice) {
      await copyToClipboard(invoice);
      setCopySuccess(true);
    }
  };

  const openWallet = () => {
    if (invoice) {
      window.location.assign("lightning:" + invoice);
    }
  };

  const amount = getAmount();

  return (
    <>
      <Modal open={open} onClose={handleClose}>
        <ModalBox>
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            mb={2}
          >
            <Typography variant="h6" fontWeight={700}>
              {invoice ? "Pay Invoice" : `Zap ${recipientName || "this post"}`}
            </Typography>
            <IconButton onClick={handleClose} size="small">
              <Close />
            </IconButton>
          </Box>

          {!invoice ? (
            <>
              <Typography
                variant="body2"
                color="text.secondary"
                mb={2}
                textAlign="center"
              >
                Choose an amount in sats
              </Typography>

              <Box
                display="flex"
                flexWrap="wrap"
                gap={1}
                justifyContent="center"
                mb={2}
              >
                {PRESET_AMOUNTS.map((amt) => (
                  <AmountButton
                    key={amt}
                    selected={selectedAmount === amt && !customAmount}
                    onClick={() => handlePresetClick(amt)}
                  >
                    {amt.toLocaleString()}
                  </AmountButton>
                ))}
              </Box>

              <TextField
                fullWidth
                placeholder="Custom amount"
                value={customAmount}
                onChange={handleCustomChange}
                type="text"
                inputMode="numeric"
                sx={{
                  mb: 3,
                  "& .MuiOutlinedInput-root": {
                    borderRadius: 3,
                  },
                }}
                InputProps={{
                  endAdornment: (
                    <Typography color="text.secondary">sats</Typography>
                  ),
                }}
              />

              <ZapButton
                fullWidth
                onClick={handleZap}
                disabled={amount <= 0 || loading}
                startIcon={
                  loading ? (
                    <CircularProgress size={20} color="inherit" />
                  ) : (
                    <span style={{ fontSize: "1.2rem" }}>&#9889;</span>
                  )
                }
              >
                {loading
                  ? "Getting Invoice..."
                  : `Zap ${amount.toLocaleString()} sats`}
              </ZapButton>
            </>
          ) : (
            <>
              <Box
                display="flex"
                justifyContent="center"
                mb={3}
                p={2}
                bgcolor="white"
                borderRadius={3}
              >
                <QRCodeSVG
                  value={invoice}
                  size={200}
                  level="M"
                  includeMargin={false}
                />
              </Box>

              <Typography
                variant="body2"
                color="text.secondary"
                textAlign="center"
                mb={2}
                sx={{
                  wordBreak: "break-all",
                  fontSize: "0.75rem",
                  opacity: 0.7,
                  maxHeight: 60,
                  overflow: "hidden",
                }}
              >
                {invoice.substring(0, 80)}...
              </Typography>

              <Box display="flex" gap={1.5}>
                <ActionButton
                  variant="outlined"
                  onClick={copyInvoice}
                  startIcon={<ContentCopy />}
                >
                  Copy
                </ActionButton>
                <ActionButton
                  variant="outlined"
                  onClick={openWallet}
                  startIcon={<OpenInNew />}
                >
                  Open Wallet
                </ActionButton>
              </Box>
            </>
          )}
        </ModalBox>
      </Modal>

      <Snackbar
        open={copySuccess}
        autoHideDuration={2000}
        onClose={() => setCopySuccess(false)}
        message="Invoice copied to clipboard"
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </>
  );
};

export default ZapModal;
