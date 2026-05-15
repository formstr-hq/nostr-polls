import React, { useState } from "react";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import SystemUpdateIcon from "@mui/icons-material/SystemUpdate";
import { useAppUpdate } from "../../hooks/useAppUpdate";

export const UpdateBanner: React.FC = () => {
  const { update, dismiss } = useAppUpdate();
  const [notesOpen, setNotesOpen] = useState(false);

  if (!update) return null;

  const handleInstall = () => {
    if (!update.asset.url) return;
    // Capacitor routes _blank to the system browser; Chrome downloads the APK
    // and Android then prompts the user to install.
    window.open(update.asset.url, "_blank");
  };

  return (
    <Collapse in>
      <Alert
        severity={update.required ? "warning" : "info"}
        icon={<SystemUpdateIcon fontSize="inherit" />}
        action={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {update.releaseNotes && (
              <Button
                size="small"
                color="inherit"
                onClick={() => setNotesOpen(true)}
              >
                What's new
              </Button>
            )}
            <Button
              size="small"
              variant="contained"
              color="primary"
              onClick={handleInstall}
              disabled={!update.asset.url}
            >
              Update
            </Button>
            {!update.required && (
              <IconButton
                size="small"
                aria-label="Dismiss update"
                color="inherit"
                onClick={dismiss}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
        }
        sx={{ borderRadius: 0 }}
      >
        <AlertTitle sx={{ mb: 0 }}>
          {update.required ? "Update required" : "Update available"}
        </AlertTitle>
        <Typography variant="body2">
          Pollerama {update.latestVersion} is out (you have {update.currentVersion}).
        </Typography>
      </Alert>

      <Dialog
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>What's new in {update.latestVersion}</DialogTitle>
        <DialogContent dividers>
          <Typography
            variant="body2"
            component="pre"
            sx={{
              whiteSpace: "pre-wrap",
              fontFamily: "inherit",
              m: 0,
            }}
          >
            {update.releaseNotes || "No release notes provided."}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNotesOpen(false)}>Close</Button>
          <Button
            variant="contained"
            onClick={handleInstall}
            disabled={!update.asset.url}
          >
            Update
          </Button>
        </DialogActions>
      </Dialog>
    </Collapse>
  );
};

export default UpdateBanner;
