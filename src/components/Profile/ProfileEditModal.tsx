import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  CircularProgress,
  Avatar,
  Typography,
} from "@mui/material";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import { User } from "../../contexts/user-context";
import { useUserContext } from "../../hooks/useUserContext";
import { signerManager } from "../../singletons/Signer/SignerManager";
import { useNotification } from "../../contexts/notification-context";
import { uploadToBlossom, getBlossomServer } from "../../services/blossomService";
import { signEvent } from "../../nostr";

interface ProfileEditModalProps {
  open: boolean;
  onClose: () => void;
  userProfile: User | null;
}

export const ProfileEditModal: React.FC<ProfileEditModalProps> = ({
  open,
  onClose,
  userProfile,
}) => {
  const { user } = useUserContext();
  const { showNotification } = useNotification();
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [about, setAbout] = useState("");
  const [picture, setPicture] = useState("");
  const [banner, setBanner] = useState("");
  const [website, setWebsite] = useState("");
  const [nip05, setNip05] = useState("");
  const [lud16, setLud16] = useState("");

  useEffect(() => {
    if (open && userProfile) {
      setName(userProfile.name || "");
      setDisplayName(userProfile.display_name || "");
      setAbout(userProfile.about || "");
      setPicture(userProfile.picture || "");
      setBanner(userProfile.banner || "");
      setWebsite(userProfile.website || "");
      setNip05(userProfile.nip05 || "");
      setLud16(userProfile.lud16 || "");
    }
  }, [open, userProfile]);

  const [uploadingField, setUploadingField] = useState<"picture" | "banner" | null>(null);

  const handleImageUpload = async (file: File, field: "picture" | "banner") => {
    setUploadingField(field);
    try {
      const url = await uploadToBlossom(
        file,
        getBlossomServer(),
        (template) => signEvent(template, user?.privateKey)
      );
      if (field === "picture") {
        setPicture(url);
      } else {
        setBanner(url);
      }
      showNotification("Image uploaded successfully!", "success");
    } catch (err) {
      showNotification(
        "Upload failed: " + (err instanceof Error ? err.message : String(err)),
        "error"
      );
    } finally {
      setUploadingField(null);
    }
  };

  const handleSave = async () => {
    if (!user) return;

    const cleanNip05 = nip05.trim();
    const cleanLud16 = lud16.trim();

    if (cleanNip05 && !cleanNip05.includes("@")) {
      showNotification("NIP-05 identifier must contain an '@' symbol (e.g. name@domain.com).", "error");
      return;
    }

    if (cleanLud16 && !cleanLud16.includes("@")) {
      showNotification("Lightning Address (LUD-16) must contain an '@' symbol (e.g. name@wallet.com).", "error");
      return;
    }

    setLoading(true);
    try {
      await signerManager.publishKind0({
        pubkey: user.pubkey,
        name: name.trim(),
        display_name: displayName.trim(),
        about: about.trim(),
        picture: picture.trim(),
        banner: banner.trim(),
        website: website.trim(),
        nip05: cleanNip05,
        lud16: cleanLud16,
      });
      showNotification("Profile updated successfully!");
      
      // Delay slightly so the relays can propagate, then notify the SignerManager to refresh cache
      setTimeout(() => {
        signerManager.afterLogin(user.pubkey);
      }, 1000);
      
      onClose();
    } catch (err) {
      console.error("Failed to update profile:", err);
      showNotification(
        "Failed to update profile: " + (err instanceof Error ? err.message : String(err)),
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Edit Profile</DialogTitle>
      <DialogContent dividers>
        <Box display="flex" flexDirection="column" gap={2}>
          <TextField
            label="Name / Username"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            size="small"
            placeholder="e.g. alice"
          />
          <TextField
            label="Display Name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            fullWidth
            size="small"
            placeholder="e.g. Alice Nakamoto"
          />
          <TextField
            label="About"
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            fullWidth
            multiline
            rows={3}
            size="small"
          />
          <Box display="flex" flexDirection="column" gap={1}>
            <Typography variant="body2" color="text.secondary">Profile Picture</Typography>
            <Box display="flex" flexDirection="row" gap={2} alignItems="center">
              <Avatar src={picture} sx={{ width: 64, height: 64 }} />
              <Button
                component="label"
                variant="outlined"
                startIcon={uploadingField === "picture" ? <CircularProgress size={20} /> : <PhotoCameraIcon />}
                disabled={uploadingField === "picture"}
              >
                Upload Picture
                <input
                  type="file"
                  hidden
                  accept="image/*"
                  onChange={(e) => {
                    if (e.target.files?.[0]) handleImageUpload(e.target.files[0], "picture");
                    e.target.value = "";
                  }}
                />
              </Button>
            </Box>
          </Box>

          <Box display="flex" flexDirection="column" gap={1}>
            <Typography variant="body2" color="text.secondary">Banner Image</Typography>
            <Box
              sx={{
                width: "100%",
                height: 120,
                borderRadius: 1,
                background: banner ? `url(${banner}) center/cover no-repeat` : "#e0e0e0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px dashed #ccc",
              }}
            >
              <Button
                component="label"
                variant="contained"
                startIcon={uploadingField === "banner" ? <CircularProgress size={20} /> : <PhotoCameraIcon />}
                disabled={uploadingField === "banner"}
                sx={{
                  backgroundColor: "rgba(0,0,0,0.6)",
                  "&:hover": { backgroundColor: "rgba(0,0,0,0.8)" },
                }}
              >
                Upload Banner
                <input
                  type="file"
                  hidden
                  accept="image/*"
                  onChange={(e) => {
                    if (e.target.files?.[0]) handleImageUpload(e.target.files[0], "banner");
                    e.target.value = "";
                  }}
                />
              </Button>
            </Box>
          </Box>
          <TextField
            label="Website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            fullWidth
            size="small"
            placeholder="https://..."
          />
          <TextField
            label="NIP-05 Identifier"
            value={nip05}
            onChange={(e) => setNip05(e.target.value)}
            fullWidth
            size="small"
            placeholder="name@domain.com"
          />
          <TextField
            label="Lightning Address (LUD-16)"
            value={lud16}
            onChange={(e) => setLud16(e.target.value)}
            fullWidth
            size="small"
            placeholder="name@wallet.com"
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading} color="inherit">
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={loading} variant="contained">
          {loading ? <CircularProgress size={24} /> : "Save Profile"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
