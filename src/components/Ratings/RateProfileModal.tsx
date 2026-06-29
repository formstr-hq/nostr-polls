import React, { useState } from "react";
import {
  Box,
  Button,
  Modal,
  TextField,
  Typography,
  CircularProgress,
} from "@mui/material";
import { nip19, Event } from "nostr-tools";
import { dataLayer } from "@formstr/local-relay";
import ProfileCard from "../Profile/ProfileCard";
import { useBackClose } from "../../hooks/useBackClose";

interface RateProfileModalProps {
  open: boolean;
  onClose: () => void;
}

const RateProfileModal: React.FC<RateProfileModalProps> = ({
  open,
  onClose,
}) => {
  const [npubInput, setNpubInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<Event | null>(null);
  useBackClose(open, onClose);

  const handleNpubSubmit = async () => {
    setLoading(true);
    try {
      const { data: pubkey } = nip19.decode(npubInput);

      const handle = dataLayer.observe(
        [
          {
            kinds: [0],
            authors: [pubkey as string],
            limit: 1,
          },
        ],
        {
          onEvent: (event) => {
            setProfile(event);
            setLoading(false);
            handle.unobserve();
          },
          // No onEose: the local EOSE precedes the worker's upstream fetch, so
          // the profile arrives via onEvent. Fall back below if it never does.
        }
      );
      setTimeout(() => {
        setLoading(false);
        handle.unobserve();
      }, 5000);
    } catch (e) {
      alert("Invalid npub.");
      setLoading(false);
    }
  };

  const handleClose = () => {
    setProfile(null);
    setNpubInput("");
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose}>
      <Box
        sx={{
          p: 4,
          bgcolor: "background.paper",
          borderRadius: 2,
          boxShadow: 24,
          maxWidth: 500,
          mx: "auto",
          mt: "10%",
        }}
      >
        <Typography variant="h6" mb={2}>
          Rate a Profile
        </Typography>

        {!profile ? (
          <>
            <TextField
              fullWidth
              label="npub"
              variant="outlined"
              value={npubInput}
              onChange={(e) => setNpubInput(e.target.value)}
              sx={{ mb: 2 }}
              disabled={loading}
            />
            <Button
              variant="contained"
              fullWidth
              onClick={handleNpubSubmit}
              disabled={loading}
            >
              {loading ? <CircularProgress size={24} /> : "Load Profile"}
            </Button>
          </>
        ) : (
          <>
            <ProfileCard event={profile} />
            <Button
              variant="outlined"
              fullWidth
              sx={{ mt: 2 }}
              onClick={handleClose}
            >
              Close
            </Button>
          </>
        )}
      </Box>
    </Modal>
  );
};

export default RateProfileModal;
