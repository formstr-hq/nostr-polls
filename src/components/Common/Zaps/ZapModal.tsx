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
  ToggleButtonGroup,
  ToggleButton,
} from "@mui/material";
import { Close, ContentCopy, OpenInNew } from "@mui/icons-material";
import { QRCodeSVG } from "qrcode.react";
import { styled } from "@mui/system";
import { useBackClose } from "../../../hooks/useBackClose";
import { buildMoneroUri } from "../../../utils/payto";

interface ZapModalProps {
  open: boolean;
  onClose: () => void;
  onZap: (amount: number) => Promise<string | null>;
  recipientName?: string;
  zapConfirmed?: boolean;
  /** Amount (sats) to preselect when the modal opens — e.g. from a hold-to-zap ramp. */
  initialAmount?: number;
  /** Recipient's Monero address (NIP-A3 payto target), when they have one. */
  moneroAddress?: string | null;
}

type PaymentMethod = "lightning" | "monero";

const PRESET_AMOUNTS = [21, 100, 500, 1000, 5000];
const MONERO_PRESET_AMOUNTS = [0.001, 0.01, 0.1, 0.5, 1];

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

const MoneroZapButton = styled(Button)({
  borderRadius: 12,
  padding: "14px 24px",
  fontWeight: 700,
  fontSize: "1.1rem",
  background: "linear-gradient(135deg, #F7931A 0%, #FF6600 100%)",
  color: "#fff",
  "&:hover": {
    background: "linear-gradient(135deg, #e08617 0%, #e65c00 100%)",
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
  moneroAddress,
}) => {
  const [selectedAmount, setSelectedAmount] = useState<number | null>(100);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [invoice, setInvoice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("lightning");
  // Monero URI to show as a QR once the user confirms the amount.
  const [moneroUri, setMoneroUri] = useState<string | null>(null);
  useBackClose(open, onClose);

  const hasMonero = Boolean(moneroAddress);
  const presets = method === "monero" ? MONERO_PRESET_AMOUNTS : PRESET_AMOUNTS;

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
    setMethod("lightning");
    setMoneroUri(null);
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
    setMoneroUri(null);
    onClose();
  };

  const getAmount = (): number => {
    if (customAmount) {
      return parseFloat(customAmount) || 0;
    }
    return selectedAmount || 0;
  };

  const handleMethodChange = (
    _: React.MouseEvent<HTMLElement>,
    newMethod: PaymentMethod | null
  ) => {
    if (!newMethod) return;
    setMethod(newMethod);
    // Reset the amount to the default preset for the new currency.
    setSelectedAmount(newMethod === "monero" ? 0.01 : 100);
    setCustomAmount("");
    setMoneroUri(null);
  };

  const handlePresetClick = (amount: number) => {
    setSelectedAmount(amount);
    setCustomAmount("");
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value =
      method === "monero"
        ? e.target.value.replace(/[^0-9.]/g, "")
        : e.target.value.replace(/\D/g, "");
    setCustomAmount(value);
    if (value) {
      setSelectedAmount(null);
    }
  };

  const handleZap = async () => {
    const amount = getAmount();
    if (amount <= 0) return;

    if (method === "monero") {
      if (!moneroAddress) return;
      setMoneroUri(buildMoneroUri(moneroAddress, amount));
      return;
    }

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

  const copyText = async () => {
    const text = method === "monero" ? moneroUri : invoice;
    if (text) {
      await copyToClipboard(text);
      setCopySuccess(true);
    }
  };

  const openWallet = () => {
    const text = method === "monero" ? moneroUri : invoice;
    if (text) {
      window.location.assign(text);
    }
  };

  const amount = getAmount();
  const showPayment = method === "monero" ? moneroUri : invoice;

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
              {showPayment
                ? "Pay Invoice"
                : `Zap ${recipientName || "this post"}`}
            </Typography>
            <IconButton onClick={handleClose} size="small">
              <Close />
            </IconButton>
          </Box>

          {!showPayment ? (
            <>
              <Typography
                variant="body2"
                color="text.secondary"
                mb={2}
                textAlign="center"
              >
                Choose an amount in {method === "monero" ? "Monero" : "sats"}
              </Typography>

              {hasMonero && (
                <Box display="flex" justifyContent="center" mb={2}>
                  <ToggleButtonGroup
                    value={method}
                    exclusive
                    onChange={handleMethodChange}
                    size="small"
                  >
                    <ToggleButton value="lightning">⚡ Sats</ToggleButton>
                    <ToggleButton value="monero">ɱ Monero</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
              )}

              <Box
                display="flex"
                flexWrap="wrap"
                gap={1}
                justifyContent="center"
                mb={2}
              >
                {presets.map((amt) => (
                  <AmountButton
                    key={amt}
                    selected={selectedAmount === amt && !customAmount}
                    onClick={() => handlePresetClick(amt)}
                  >
                    {method === "monero" ? amt : amt.toLocaleString()}
                  </AmountButton>
                ))}
              </Box>

              <TextField
                fullWidth
                placeholder="Custom amount"
                value={customAmount}
                onChange={handleCustomChange}
                type="text"
                inputMode={method === "monero" ? "decimal" : "numeric"}
                sx={{
                  mb: 3,
                  "& .MuiOutlinedInput-root": {
                    borderRadius: 3,
                  },
                }}
                InputProps={{
                  endAdornment: (
                    <Typography color="text.secondary">
                      {method === "monero" ? "XMR" : "sats"}
                    </Typography>
                  ),
                }}
              />

              {method === "monero" ? (
                <MoneroZapButton
                  fullWidth
                  onClick={handleZap}
                  disabled={amount <= 0 || !moneroAddress}
                  startIcon={<span style={{ fontSize: "1.2rem" }}>&#435;</span>}
                >
                  Zap {amount} XMR
                </MoneroZapButton>
              ) : (
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
              )}
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
                  value={showPayment}
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
                {showPayment.substring(0, 80)}...
              </Typography>

              <Box display="flex" gap={1.5}>
                <ActionButton
                  variant="outlined"
                  onClick={copyText}
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
        message="Copied to clipboard"
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </>
  );
};

export default ZapModal;