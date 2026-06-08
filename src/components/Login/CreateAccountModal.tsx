import { copyToClipboard } from "../../utils/common";
// components/Login/CreateAccountModal.tsx
import React, { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Avatar,
  Stack,
  Typography,
  Alert,
  Box,
  InputAdornment,
  IconButton,
} from "@mui/material";
import { Visibility, VisibilityOff } from "@mui/icons-material";
import { signerManager } from "../../singletons/Signer/SignerManager";
import { useUserContext } from "../../hooks/useUserContext";
import { useNotification } from "../../contexts/notification-context";
import { useBackClose } from "../../hooks/useBackClose";

interface Props {
  open: boolean;
  onClose: () => void;
}

export const CreateAccountModal: React.FC<Props> = ({ open, onClose }) => {
  const [name, setName] = useState("");
  const [picture, setPicture] = useState("");
  const [about, setAbout] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [keysVisible, setKeysVisible] = useState(false);
  const [npub, setNpub] = useState("");
  const [ncryptsec, setNcryptsec] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { setUser } = useUserContext();
  useBackClose(open, onClose);

  const handleCreateAccount = async () => {
    if (!passphrase) {
      setError("Choose a passphrase to encrypt your account");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await signerManager.createGuestAccount(passphrase, {
        name,
        picture,
        about,
      });
      setNpub(result.npub);
      setNcryptsec(result.ncryptsec);
      setUser(signerManager.getUser());
      setKeysVisible(true);
    } catch (e) {
      console.error("Failed to create account", e);
      setError("Something went wrong creating your account.");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setName("");
    setPicture("");
    setAbout("");
    setPassphrase("");
    setShowPassphrase(false);
    setKeysVisible(false);
    setNpub("");
    setNcryptsec("");
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Create Account</DialogTitle>
      <DialogContent>
        {keysVisible ? (
          <Box mt={2}>
            <Alert severity="warning" sx={{ mb: 2 }}>
              <strong>Back this up now.</strong> Your encrypted key
              (ncryptsec) and passphrase are the <em>only</em> way to recover
              this account. If you lose them, your account is gone forever.
            </Alert>

            <Stack spacing={2}>
              <Box>
                <Typography variant="subtitle2">Public Key (npub)</Typography>
                <MonospaceDisplay value={npub} />
              </Box>

              <Box>
                <Typography variant="subtitle2">
                  Encrypted Private Key (ncryptsec)
                </Typography>
                <MonospaceDisplay value={ncryptsec} />
              </Box>
            </Stack>
          </Box>
        ) : (
          <Stack spacing={2} mt={1}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Display Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
            />
            <TextField
              label="Image URL"
              value={picture}
              onChange={(e) => setPicture(e.target.value)}
              fullWidth
            />
            <TextField
              label="About (optional description)"
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              fullWidth
              multiline
              rows={2}
            />
            <TextField
              label="Passphrase"
              type={showPassphrase ? "text" : "password"}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              fullWidth
              required
              helperText="Encrypts your private key on this device. You'll need it to sign on next launch."
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowPassphrase((v) => !v)}
                      edge="end"
                    >
                      {showPassphrase ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Preview
              </Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                <Avatar src={picture} sx={{ width: 56, height: 56 }}>
                  {!picture && name ? name[0] : "?"}
                </Avatar>
                <Box>
                  <Typography variant="subtitle1">
                    {name || "Anonymous"}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {about || "No description provided."}
                  </Typography>
                </Box>
              </Stack>
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {keysVisible ? (
          <Button onClick={handleClose} variant="contained">
            Done
          </Button>
        ) : (
          <>
            <Button onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateAccount}
              variant="contained"
              disabled={loading || !passphrase}
            >
              {loading ? "Creating…" : "Create Account"}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export const MonospaceDisplay: React.FC<{ value: string }> = ({ value }) => {
  let notification = useNotification();
  const handleCopy = async () => {
    await copyToClipboard(value);
    notification.showNotification("Copied to clipboard!");
  };

  return (
    <Box
      sx={{
        borderRadius: 1,
        px: 2,
        py: 1,
        fontFamily: "monospace",
        wordBreak: "break-all",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <Box sx={{ flex: 1 }}>{value}</Box>
      <Button size="small" onClick={handleCopy}>
        Copy
      </Button>
    </Box>
  );
};
