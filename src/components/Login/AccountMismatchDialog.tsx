import React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  Typography,
  Alert,
} from "@mui/material";
import { AccountTree } from "@mui/icons-material";
import { nip19 } from "nostr-tools";

interface Props {
  open: boolean;
  expectedPubkey: string;
  actualPubkey: string;
  onOk: () => void;
}

function shortNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 10)}…${npub.slice(-6)}`;
  } catch {
    return pubkey.slice(0, 10) + "…";
  }
}

/**
 * Blocking dialog shown when the NIP-07 extension signs as a different
 * account than the one active in this app. The action is always aborted —
 * the user must switch the active account in their extension and retry.
 *
 * Mismatch by definition is extension-only, so the instructions point at
 * the extension.
 */
export const AccountMismatchDialog: React.FC<Props> = ({
  open,
  expectedPubkey,
  actualPubkey,
  onOk,
}) => {
  return (
    <Dialog
      open={open}
      onClose={onOk}
      maxWidth="xs"
      fullWidth
      disableEnforceFocus
      disableAutoFocus
    >
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <AccountTree color="warning" />
          <span>Wrong account in your extension</span>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <Typography variant="body2" color="text.secondary">
            This action uses the account you're logged in as, but your NIP-07
            extension is set to a different one. We didn't sign or publish
            anything — switch your extension to the right account and try
            again.
          </Typography>

          <Alert severity="warning" icon={false} sx={{ py: 0.5 }}>
            <Typography variant="body2" component="div">
              <Typography component="span" variant="caption" display="block">
                Logged in here
              </Typography>
              <Typography
                variant="body2"
                sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}
              >
                {shortNpub(expectedPubkey)}
              </Typography>
            </Typography>
            <Typography variant="body2" component="div">
              <Typography component="span" variant="caption" display="block">
                Extension signed as
              </Typography>
              <Typography
                variant="body2"
                sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}
              >
                {shortNpub(actualPubkey)}
              </Typography>
            </Typography>
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onOk}>
          OK, I'll switch in my extension
        </Button>
      </DialogActions>
    </Dialog>
  );
};
