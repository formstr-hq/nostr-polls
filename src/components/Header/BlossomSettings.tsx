import React, { useState } from "react";
import {
  Box,
  Button,
  MenuItem,
  TextField,
  Typography,
  CircularProgress,
  Chip,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import {
  BLOSSOM_SERVER_KEY,
  DEFAULT_BLOSSOM_SERVER,
} from "../../services/blossomService";

const PRESET_SERVERS = [
  { label: "Primal (blossom.primal.net)", value: "https://blossom.primal.net" },
  { label: "nostr.download", value: "https://nostr.download" },
  { label: "satellite.earth", value: "https://cdn.satellite.earth" },
  { label: "blossom.oxtr.dev", value: "https://blossom.oxtr.dev" },
  { label: "blossom.band", value: "https://blossom.band" },
  { label: "Custom…", value: "custom" },
];

const CUSTOM_VALUE = "custom";

function getCurrentServer(): string {
  return localStorage.getItem(BLOSSOM_SERVER_KEY) || DEFAULT_BLOSSOM_SERVER;
}

function isPreset(url: string): boolean {
  return PRESET_SERVERS.some((s) => s.value === url);
}

export const BlossomSettings: React.FC = () => {
  const saved = getCurrentServer();
  const [selected, setSelected] = useState<string>(
    isPreset(saved) ? saved : CUSTOM_VALUE
  );
  const [customUrl, setCustomUrl] = useState<string>(
    isPreset(saved) ? "" : saved
  );
  const [testState, setTestState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [testMsg, setTestMsg] = useState("");
  const [saveMsg, setSaveMsg] = useState("");

  const effectiveUrl =
    selected === CUSTOM_VALUE ? customUrl.trim() : selected;

  const handleSave = () => {
    if (!effectiveUrl) return;
    localStorage.setItem(BLOSSOM_SERVER_KEY, effectiveUrl);
    setSaveMsg("Saved!");
    setTimeout(() => setSaveMsg(""), 2000);
    setTestState("idle");
  };

  const handleTest = async () => {
    if (!effectiveUrl) return;
    setTestState("loading");
    setTestMsg("");
    try {
      // BUD-01: GET /list/<some-pubkey> or just HEAD / — we probe the root
      const res = await fetch(effectiveUrl.replace(/\/$/, "") + "/", {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok || res.status === 404 || res.status === 401) {
        // 401 = server is alive but requires auth (expected for upload-only endpoints)
        setTestState("ok");
        setTestMsg("Server reachable");
      } else {
        setTestState("error");
        setTestMsg(`HTTP ${res.status}`);
      }
    } catch (e: any) {
      setTestState("error");
      setTestMsg(e?.message || "Unreachable");
    }
  };

  return (
    <Box p={2} sx={{ bgcolor: "background.paper", color: "text.primary" }}>
      <Typography variant="h6" gutterBottom>
        Media / Blossom Settings
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Images and videos you attach to notes are uploaded to a{" "}
        <a
          href="https://github.com/hzrd149/blossom"
          target="_blank"
          rel="noopener noreferrer"
        >
          Blossom
        </a>{" "}
        server. Choose one below or enter your own.
      </Typography>

      <Box mt={2}>
        <TextField
          select
          label="Blossom server"
          fullWidth
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setTestState("idle");
            setSaveMsg("");
          }}
          margin="normal"
        >
          {PRESET_SERVERS.map((s) => (
            <MenuItem key={s.value} value={s.value}>
              {s.label}
            </MenuItem>
          ))}
        </TextField>

        {selected === CUSTOM_VALUE && (
          <TextField
            label="Custom server URL"
            fullWidth
            value={customUrl}
            onChange={(e) => {
              setCustomUrl(e.target.value);
              setTestState("idle");
              setSaveMsg("");
            }}
            margin="normal"
            placeholder="https://your-blossom-server.com"
          />
        )}

        <Box mt={2} display="flex" alignItems="center" gap={1.5} flexWrap="wrap">
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!effectiveUrl}
          >
            Save
          </Button>

          <Button
            variant="outlined"
            onClick={handleTest}
            disabled={!effectiveUrl || testState === "loading"}
            startIcon={
              testState === "loading" ? (
                <CircularProgress size={16} />
              ) : undefined
            }
          >
            Test connection
          </Button>

          {testState === "ok" && (
            <Chip
              icon={<CheckCircleOutlineIcon />}
              label={testMsg}
              color="success"
              size="small"
              variant="outlined"
            />
          )}
          {testState === "error" && (
            <Chip
              icon={<ErrorOutlineIcon />}
              label={testMsg}
              color="error"
              size="small"
              variant="outlined"
            />
          )}
          {saveMsg && (
            <Typography variant="body2" color="success.main">
              ✅ {saveMsg}
            </Typography>
          )}
        </Box>

        <Box mt={2}>
          <Typography variant="caption" color="text.secondary">
            Currently active:{" "}
            <strong>{getCurrentServer()}</strong>
          </Typography>
        </Box>
      </Box>
    </Box>
  );
};
