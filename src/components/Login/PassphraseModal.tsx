import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Stack,
  Typography,
  Alert,
  InputAdornment,
  IconButton,
} from "@mui/material";
import { Visibility, VisibilityOff } from "@mui/icons-material";
import { nip19 } from "nostr-tools";

export type PassphraseModalMode = "unlock" | "migrate";

interface Props {
  open: boolean;
  mode: PassphraseModalMode;
  pubkey: string;
  error?: string;
  attempt: number;
  submitting: boolean;
  onSubmit: (passphrase: string) => void;
  onCancel: () => void;
}

function shortNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
  } catch {
    return pubkey.slice(0, 10) + "…";
  }
}

export const PassphraseModal: React.FC<Props> = ({
  open,
  mode,
  pubkey,
  error,
  attempt,
  submitting,
  onSubmit,
  onCancel,
}) => {
  const [passphrase, setPassphrase] = useState("");
  const [show, setShow] = useState(false);

  // Reset on each new prompt (initial open OR retry from a wrong passphrase).
  useEffect(() => {
    setPassphrase("");
    setShow(false);
  }, [attempt]);

  const handleSubmit = () => {
    if (!passphrase || submitting) return;
    onSubmit(passphrase);
  };

  const title =
    mode === "unlock"
      ? "Unlock your account"
      : "Set a passphrase for your account";

  const helper =
    mode === "unlock"
      ? "Enter your passphrase to decrypt your private key for this session."
      : "Your account is being upgraded to NIP-49 encrypted storage. Choose a passphrase — you'll need it on next launch.";

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <Typography variant="body2" color="text.secondary">
            {helper}
          </Typography>

          <Alert severity="info" icon={false} sx={{ py: 0.5 }}>
            <Typography
              variant="caption"
              sx={{ fontFamily: "monospace", fontSize: "0.7rem" }}
            >
              {shortNpub(pubkey)}
            </Typography>
          </Alert>

          {error && (
            <Alert severity="error" sx={{ py: 0.5 }}>
              {error}
            </Alert>
          )}

          <TextField
            label="Passphrase"
            type={show ? "text" : "password"}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            autoFocus
            fullWidth
            disabled={submitting}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={() => setShow((v) => !v)} edge="end">
                    {show ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!passphrase || submitting}
        >
          {submitting
            ? "Checking…"
            : mode === "unlock"
              ? "Unlock"
              : "Encrypt"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
