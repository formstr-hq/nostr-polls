// components/LoginModal.tsx
import React, { useEffect, useState, type ReactNode } from "react";
import {
  Dialog,
  Stack,
  Button,
  TextField,
  Typography,
  Collapse,
  Box,
  Alert,
  ButtonBase,
  Divider,
  InputAdornment,
  IconButton,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import VpnKeyOutlinedIcon from "@mui/icons-material/VpnKeyOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import PhonelinkLockOutlinedIcon from "@mui/icons-material/PhonelinkLockOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import PersonOutlinedIcon from "@mui/icons-material/PersonOutlined";
import HowToVoteOutlinedIcon from "@mui/icons-material/HowToVoteOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { Visibility, VisibilityOff } from "@mui/icons-material";
import { signerManager } from "../../singletons/Signer/SignerManager";
import { useUserContext } from "../../hooks/useUserContext";
import { CreateAccountModal } from "./CreateAccountModal";
import { isAndroidNative, isNative } from "../../utils/platform";
import { NostrSignerPlugin } from "nostr-signer-capacitor-plugin";
import { SignerAppInfo } from "nostr-signer-capacitor-plugin/dist/esm/definitions";
import { useBackClose } from "../../hooks/useBackClose";
import { nip19 } from "nostr-tools";

interface Props {
  open: boolean;
  onClose: () => void;
}

export const LoginModal: React.FC<Props> = ({ open, onClose }) => {
  const { setUser } = useUserContext();
  const theme = useTheme();
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [showNsec, setShowNsec] = useState(false);
  const [showNip46, setShowNip46] = useState(false);
  const [nsec, setNsec] = useState("");
  const [showNsecText, setShowNsecText] = useState(false);
  const [nsecError, setNsecError] = useState<string | null>(null);
  const [nsecLoading, setNsecLoading] = useState(false);
  const [bunkerUri, setBunkerUri] = useState("");
  const [error, setError] = useState("");
  const [installedSigners, setInstalledSigners] = useState<SignerAppInfo[]>([]);
  useBackClose(open, onClose);

  useEffect(() => {
    const initialize = async () => {
      if (!isAndroidNative()) return;
      try {
        const result = await NostrSignerPlugin.getInstalledSignerApps();
        setInstalledSigners(result.apps);
      } catch (error) {
        console.warn("Failed to load installed Android signers", error);
      }
    };
    initialize();
  }, []);

  const isDark = theme.palette.mode === "dark";
  const accentAlpha = isDark ? "22" : "18";

  const handleLoginWithNip07 = async () => {
    setError("");
    const unsubscribe = signerManager.onChange(async () => {
      setUser(signerManager.getUser());
      unsubscribe();
    });
    try {
      await signerManager.loginWithNip07();
      onClose();
    } catch (err) {
      setError("NIP-07 login failed");
      console.error(err);
    }
  };

  const handleLoginWithNip46 = async () => {
    if (!bunkerUri) return;
    setError("");
    const unsubscribe = signerManager.onChange(async () => {
      setUser(signerManager.getUser());
      unsubscribe();
    });
    try {
      await signerManager.loginWithNip46(bunkerUri);
      onClose();
    } catch (err) {
      setError("Failed to connect to remote signer.");
      console.error(err);
    }
  };

  const handleNsecLogin = async () => {
    setNsecError(null);
    const trimmed = nsec.trim();
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type !== "nsec") throw new Error();
    } catch {
      setNsecError("Invalid nsec. It should start with nsec1…");
      return;
    }
    try {
      setNsecLoading(true);
      await signerManager.loginWithNsec(trimmed);
      onClose();
    } catch (e) {
      setNsecError("Failed to log in with nsec");
    } finally {
      setNsecLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: { borderRadius: 3, overflow: "hidden", bgcolor: "background.paper" },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 3,
          pt: 4,
          pb: 3,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 1.5,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Box
          sx={{
            width: 56,
            height: 56,
            borderRadius: 2,
            bgcolor: `${theme.palette.primary.main}${accentAlpha}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: theme.palette.primary.main,
          }}
        >
          <HowToVoteOutlinedIcon sx={{ fontSize: 32 }} />
        </Box>
        <Box textAlign="center">
          <Typography variant="h6" fontWeight={700}>
            Sign in
          </Typography>
          <Typography variant="body2" color="text.secondary" mt={0.5}>
            Choose how you'd like to access Pollerama
          </Typography>
        </Box>
        {error && (
          <Alert severity="error" sx={{ width: "100%", borderRadius: 2 }}>
            {error}
          </Alert>
        )}
      </Box>

      {/* Options */}
      <Stack divider={<Divider />}>
        {/* NIP-55 Android signers */}
        {isAndroidNative() &&
          installedSigners.map((app) => (
            <OptionButton
              key={app.packageName}
              icon={
                app.iconUrl ? (
                  <img
                    src={app.iconUrl}
                    alt={app.name}
                    style={{ width: 24, height: 24, borderRadius: 4 }}
                  />
                ) : (
                  <PhonelinkLockOutlinedIcon />
                )
              }
              title={app.name}
              description="Sign with external Android signer"
              accentColor={theme.palette.secondary.main}
              accentAlpha={accentAlpha}
              onClick={async () => {
                try {
                  await signerManager.loginWithNip55(app.packageName);
                  onClose();
                } catch {
                  setError("Signer sign-in failed");
                }
              }}
            />
          ))}

        {/* NIP-07 — web only */}
        {!isNative && (
          <OptionButton
            icon={<VpnKeyOutlinedIcon />}
            title="Browser Extension"
            description="Alby, nos2x, Flamingo"
            accentColor={theme.palette.primary.main}
            accentAlpha={accentAlpha}
            onClick={handleLoginWithNip07}
          />
        )}

        {/* nsec — native only, inline collapse */}
        {isNative && (
          <Box>
            <OptionButton
              icon={<LockOutlinedIcon />}
              title="Private Key (nsec)"
              description="Stored securely on this device"
              accentColor={theme.palette.primary.main}
              accentAlpha={accentAlpha}
              onClick={() => {
                setShowNsec((p) => !p);
                setNsecError(null);
              }}
              chevronRotated={showNsec}
            />
            <Collapse in={showNsec}>
              <Box
                sx={{
                  px: 2,
                  pb: 2,
                  bgcolor: `${theme.palette.primary.main}${accentAlpha}`,
                }}
              >
                <TextField
                  fullWidth
                  size="small"
                  label="nsec1..."
                  type={showNsecText ? "text" : "password"}
                  value={nsec}
                  onChange={(e) => setNsec(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleNsecLogin()}
                  error={!!nsecError}
                  helperText={nsecError}
                  sx={{ mt: 1 }}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          onClick={() => setShowNsecText((v) => !v)}
                          edge="end"
                        >
                          {showNsecText ? (
                            <VisibilityOff fontSize="small" />
                          ) : (
                            <Visibility fontSize="small" />
                          )}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
                <Button
                  variant="contained"
                  fullWidth
                  onClick={handleNsecLogin}
                  disabled={!nsec || nsecLoading}
                  sx={{ mt: 1 }}
                >
                  {nsecLoading ? "Signing in…" : "Sign in"}
                </Button>
              </Box>
            </Collapse>
          </Box>
        )}

        {/* NIP-46 Bunker, inline collapse */}
        <Box>
          <OptionButton
            icon={<HubOutlinedIcon />}
            title="Nostr Bunker"
            description="Connect via NIP-46"
            accentColor={theme.palette.secondary.main}
            accentAlpha={accentAlpha}
            onClick={() => setShowNip46((p) => !p)}
            chevronRotated={showNip46}
          />
          <Collapse in={showNip46}>
            <Box
              sx={{
                px: 2,
                pb: 2,
                display: "flex",
                gap: 1,
                bgcolor: `${theme.palette.secondary.main}${accentAlpha}`,
              }}
            >
              <TextField
                fullWidth
                size="small"
                label="Bunker URI"
                value={bunkerUri}
                onChange={(e) => setBunkerUri(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLoginWithNip46()}
                sx={{ mt: 1 }}
              />
              <Button
                variant="contained"
                onClick={handleLoginWithNip46}
                disabled={!bunkerUri}
                sx={{ flexShrink: 0, mt: 1 }}
              >
                Connect
              </Button>
            </Box>
          </Collapse>
        </Box>

        {/* Guest account */}
        <OptionButton
          icon={<PersonOutlinedIcon />}
          title="Guest Account"
          description="Quick access, no keys needed"
          accentColor={theme.palette.text.secondary}
          accentAlpha={accentAlpha}
          onClick={() => setShowCreateAccount(true)}
        />
      </Stack>

      {/* Footer */}
      <Box
        sx={{
          px: 3,
          py: 1.5,
          borderTop: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Button
          fullWidth
          variant="text"
          color="inherit"
          onClick={onClose}
          sx={{ color: "text.secondary", fontSize: "0.8rem" }}
        >
          Cancel
        </Button>
      </Box>

      <CreateAccountModal
        open={showCreateAccount}
        onClose={() => setShowCreateAccount(false)}
      />
    </Dialog>
  );
};

function OptionButton({
  icon,
  title,
  description,
  accentColor,
  accentAlpha,
  onClick,
  chevronRotated = false,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  accentColor: string;
  accentAlpha: string;
  onClick: () => void;
  chevronRotated?: boolean;
}) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 2,
        px: 2.5,
        py: 1.75,
        textAlign: "left",
        transition: "background 0.15s",
        "&:hover": { bgcolor: `${accentColor}${accentAlpha}` },
      }}
    >
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: 2,
          bgcolor: `${accentColor}${accentAlpha}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: accentColor,
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Box flex={1} minWidth={0}>
        <Typography variant="body1" fontWeight={600} lineHeight={1.3}>
          {title}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
      </Box>
      <ChevronRightIcon
        sx={{
          color: "text.secondary",
          opacity: 0.5,
          flexShrink: 0,
          transition: "transform 0.2s",
          transform: chevronRotated ? "rotate(90deg)" : "none",
        }}
      />
    </ButtonBase>
  );
}
