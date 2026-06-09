// components/LoginModal.tsx
import React, { useEffect, useRef, useState, type ReactNode } from "react";
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
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import VpnKeyOutlinedIcon from "@mui/icons-material/VpnKeyOutlined";
import PhonelinkLockOutlinedIcon from "@mui/icons-material/PhonelinkLockOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import PersonAddOutlinedIcon from "@mui/icons-material/PersonAddOutlined";
import QrCodeScannerOutlinedIcon from "@mui/icons-material/QrCodeScannerOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import HowToVoteOutlinedIcon from "@mui/icons-material/HowToVoteOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { QRCodeSVG } from "qrcode.react";
import { signerManager } from "../../singletons/Signer/SignerManager";
import { useUserContext } from "../../hooks/useUserContext";
import { CreateAccountModal } from "./CreateAccountModal";
import { isAndroidNative, isNative } from "../../utils/platform";
import { NostrSignerPlugin } from "nostr-signer-capacitor-plugin";
import { SignerAppInfo } from "nostr-signer-capacitor-plugin/dist/esm/definitions";
import { useBackClose } from "../../hooks/useBackClose";
import { pool } from "../../singletons";

interface Props {
  open: boolean;
  onClose: () => void;
}

type ExpandedSection = "bunker" | "ncryptsec" | "qr" | null;

export const LoginModal: React.FC<Props> = ({ open, onClose }) => {
  const { setUser } = useUserContext();
  const theme = useTheme();
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [expanded, setExpanded] = useState<ExpandedSection>(null);
  const [bunkerUri, setBunkerUri] = useState("");
  const [ncryptsec, setNcryptsec] = useState("");
  const [ncryptsecPass, setNcryptsecPass] = useState("");
  const [qrRelays, setQrRelays] = useState("wss://relay.nsec.app");
  const [qrUri, setQrUri] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [installedSigners, setInstalledSigners] = useState<SignerAppInfo[]>([]);
  const qrAbortRef = useRef<AbortController | null>(null);
  useBackClose(open, onClose);

  useEffect(() => {
    const initialize = async () => {
      const result = await NostrSignerPlugin.getInstalledSignerApps();
      setInstalledSigners(result.apps);
    };
    initialize();
  }, []);

  useEffect(() => {
    if (!open) {
      qrAbortRef.current?.abort();
      qrAbortRef.current = null;
      setExpanded(null);
      setBunkerUri("");
      setNcryptsec("");
      setNcryptsecPass("");
      setQrUri(null);
      setError("");
    }
  }, [open]);

  const isDark = theme.palette.mode === "dark";
  const accentAlpha = isDark ? "22" : "18";

  const toggleSection = (section: Exclude<ExpandedSection, null>) => {
    setError("");
    if (section !== "qr") {
      qrAbortRef.current?.abort();
      qrAbortRef.current = null;
      setQrUri(null);
    }
    setExpanded((prev) => (prev === section ? null : section));
  };

  const finishLogin = async (pubkey: string) => {
    try {
      await signerManager.afterLogin(pubkey);
    } catch (e) {
      console.warn("afterLogin failed:", e);
    }
    setUser(signerManager.getUser());
    onClose();
  };

  const handleLoginWithNip07 = async () => {
    setError("");
    try {
      const account = await signerManager.getPackageSigner().loginWithExtension();
      await finishLogin(account.pubkey);
    } catch (err) {
      setError("NIP-07 login failed");
      console.error(err);
    }
  };

  const handleLoginWithNip46 = async () => {
    if (!bunkerUri) return;
    setError("");
    try {
      const account = await signerManager
        .getPackageSigner()
        .loginWithBunkerUri(bunkerUri, { pool });
      await finishLogin(account.pubkey);
    } catch (err) {
      setError("Failed to connect to remote signer.");
      console.error(err);
    }
  };

  const handleLoginWithNcryptsec = async () => {
    if (!ncryptsec || !ncryptsecPass) return;
    setError("");
    try {
      const account = await signerManager
        .getPackageSigner()
        .loginWithNcryptsec(ncryptsec.trim(), ncryptsecPass);
      await finishLogin(account.pubkey);
    } catch (err) {
      setError("Invalid ncryptsec or passphrase.");
      console.error(err);
    }
  };

  const handleStartQr = async () => {
    const relays = qrRelays
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (relays.length === 0) {
      setError("At least one relay is required.");
      return;
    }
    setError("");
    const abort = new AbortController();
    qrAbortRef.current = abort;
    setQrUri(null);
    try {
      const account = await signerManager.getPackageSigner().loginWithNostrConnect({
        relays,
        pool,
        signal: abort.signal,
        onUri: (uri) => setQrUri(uri),
      });
      await finishLogin(account.pubkey);
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setError(err?.message ?? "Remote signer pairing failed.");
        console.error(err);
      }
      setQrUri(null);
    } finally {
      qrAbortRef.current = null;
    }
  };

  const handleCancelQr = () => {
    qrAbortRef.current?.abort();
    qrAbortRef.current = null;
    setQrUri(null);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: { borderRadius: 3, overflowY: "auto", bgcolor: "background.paper" },
      }}
    >
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

      <Stack divider={<Divider />}>
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

        <Box>
          <OptionButton
            icon={<HubOutlinedIcon />}
            title="Nostr Bunker"
            description="Connect via NIP-46 bunker URI"
            accentColor={theme.palette.secondary.main}
            accentAlpha={accentAlpha}
            onClick={() => toggleSection("bunker")}
            chevronRotated={expanded === "bunker"}
          />
          <Collapse in={expanded === "bunker"}>
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

        <Box>
          <OptionButton
            icon={<QrCodeScannerOutlinedIcon />}
            title="Remote Signer (QR)"
            description="Pair via nostrconnect QR"
            accentColor={theme.palette.secondary.main}
            accentAlpha={accentAlpha}
            onClick={() => toggleSection("qr")}
            chevronRotated={expanded === "qr"}
          />
          <Collapse in={expanded === "qr"}>
            <Box
              sx={{
                px: 2,
                pb: 2,
                pt: 1,
                display: "flex",
                flexDirection: "column",
                gap: 1,
                bgcolor: `${theme.palette.secondary.main}${accentAlpha}`,
              }}
            >
              {!qrUri ? (
                <>
                  <TextField
                    fullWidth
                    size="small"
                    label="Relays (comma-separated)"
                    value={qrRelays}
                    onChange={(e) => setQrRelays(e.target.value)}
                  />
                  <Button
                    variant="contained"
                    onClick={handleStartQr}
                    disabled={!qrRelays.trim()}
                  >
                    Generate QR
                  </Button>
                </>
              ) : (
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 1.5,
                  }}
                >
                  <Box sx={{ p: 1.5, bgcolor: "#fff", borderRadius: 2 }}>
                    <QRCodeSVG value={qrUri} size={200} />
                  </Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    textAlign="center"
                  >
                    Scan with your remote signer. Waiting for pairing&hellip;
                  </Typography>
                  <Button
                    size="small"
                    variant="text"
                    color="inherit"
                    onClick={handleCancelQr}
                  >
                    Cancel
                  </Button>
                </Box>
              )}
            </Box>
          </Collapse>
        </Box>

        <Box>
          <OptionButton
            icon={<LockOutlinedIcon />}
            title="Existing Key"
            description="Sign in with an ncryptsec"
            accentColor={theme.palette.secondary.main}
            accentAlpha={accentAlpha}
            onClick={() => toggleSection("ncryptsec")}
            chevronRotated={expanded === "ncryptsec"}
          />
          <Collapse in={expanded === "ncryptsec"}>
            <Box
              sx={{
                px: 2,
                pb: 2,
                pt: 1,
                display: "flex",
                flexDirection: "column",
                gap: 1,
                bgcolor: `${theme.palette.secondary.main}${accentAlpha}`,
              }}
            >
              <TextField
                fullWidth
                size="small"
                label="ncryptsec1..."
                multiline
                minRows={2}
                value={ncryptsec}
                onChange={(e) => setNcryptsec(e.target.value)}
              />
              <TextField
                fullWidth
                size="small"
                type="password"
                label="Passphrase"
                value={ncryptsecPass}
                onChange={(e) => setNcryptsecPass(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && handleLoginWithNcryptsec()
                }
              />
              <Button
                variant="contained"
                onClick={handleLoginWithNcryptsec}
                disabled={!ncryptsec || !ncryptsecPass}
              >
                Sign in
              </Button>
            </Box>
          </Collapse>
        </Box>

        <OptionButton
          icon={<PersonAddOutlinedIcon />}
          title="Create Account"
          description="Generate a new key, encrypted at rest"
          accentColor={theme.palette.text.secondary}
          accentAlpha={accentAlpha}
          onClick={() => setShowCreateAccount(true)}
        />
      </Stack>

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
