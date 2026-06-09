// components/User/ViewKeysModal.tsx
import React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  Alert,
  Button,
  Box,
  Stack,
} from "@mui/material";
import { nip19 } from "nostr-tools";
import { MonospaceDisplay } from "../Login/CreateAccountModal";
import { hexToBytes } from "@noble/hashes/utils.js";
import { useBackClose } from "../../hooks/useBackClose";

interface Props {
  open: boolean;
  onClose: () => void;
  pubkey: string;
  privkey: string;
}

export const ViewKeysModal: React.FC<Props> = ({
  open,
  onClose,
  pubkey,
  privkey,
}) => {
  useBackClose(open, onClose);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Your Keys</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          These keys are stored <strong>insecurely</strong> in your browser.
          Back them up or import them into a NIP-07 extension or remote signer.
          If you lose them, your account is gone forever.
        </Alert>

        <Stack spacing={2}>
          <Box>
            <Typography variant="subtitle2">Public Key (npub)</Typography>
            <MonospaceDisplay value={nip19.npubEncode(pubkey)} />
          </Box>
          <Box>
            <Typography variant="subtitle2">Private Key (nsec)</Typography>
            <MonospaceDisplay value={nip19.nsecEncode(hexToBytes(privkey))} />
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};
