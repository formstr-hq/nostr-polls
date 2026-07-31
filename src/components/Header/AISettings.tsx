import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  LinearProgress,
  Link,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import SmartphoneIcon from "@mui/icons-material/Smartphone";
import { ChangeEvent, useEffect, useState } from "react";
import { useAppContext } from "../../hooks/useAppContext";
import { useWllamaTranslation } from "../../hooks/useWllamaTranslation";
import { aiService } from "../../services/ai-service";
import { wllamaTranslationService } from "../../services/wllama-translation-service";
import { isNative } from "../../utils/platform";

const LOCAL_STORAGE_KEY = "ai-settings";
const CONFIG_KEY = "ollama-ai-config";
const DEFAULT_URL = "http://localhost:11434";
const ZAPSTORE_LINK = "https://zapstore.dev/apps/com.formstr.pollerama";

const BrowserTranslationSettings: React.FC = () => {
  const model = useWllamaTranslation();
  const environment = wllamaTranslationService.getEnvironment();

  const handleModelFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Selecting the same file again must still fire a change event after an error.
    event.target.value = "";
    if (file) await wllamaTranslationService.loadModel(file);
  };

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
        On-device translation
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Load an instruction-tuned GGUF model to translate polls locally with
        wllama. Poll text and model prompts never leave this device.
      </Typography>

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, my: 2 }}>
        <Chip
          size="small"
          color={environment.success ? "success" : "error"}
          label={environment.success ? "WebAssembly ready" : "Unsupported browser"}
        />
        {environment.success && (
          <Chip
            size="small"
            color={environment.hasWebGPU && environment.crossOriginIsolated ? "success" : "default"}
            label={
              environment.hasWebGPU && environment.crossOriginIsolated
                ? "WebGPU available"
                : "WebAssembly fallback"
            }
          />
        )}
      </Box>

      {environment.success && !environment.crossOriginIsolated && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This site is not cross-origin isolated. Translation can still use the
          WebAssembly fallback, but hosting with COOP/COEP headers enables the
          fastest runtime where supported.
        </Alert>
      )}

      {!environment.success && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {environment.error || "This browser cannot run a local model."}
        </Alert>
      )}

      {model.status === "loading" && (
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.75 }}>
            <Typography variant="body2">Loading {model.modelName}</Typography>
            <Typography variant="body2" color="text.secondary">
              {Math.round(model.progress)}%
            </Typography>
          </Box>
          <LinearProgress variant="determinate" value={model.progress} />
        </Box>
      )}

      {model.status === "ready" && (
        <Alert
          severity="success"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => wllamaTranslationService.unload()}>
              Unload
            </Button>
          }
        >
          <strong>{model.modelName}</strong> is ready using {model.usedWebGPU ? "WebGPU" : "WebAssembly"}.
        </Alert>
      )}

      {model.status === "error" && model.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {model.error}
        </Alert>
      )}

      <Button
        component="label"
        variant={model.status === "ready" ? "outlined" : "contained"}
        disabled={!environment.success || model.status === "loading"}
      >
        {model.status === "ready" ? "Replace GGUF model" : "Choose GGUF model"}
        <input hidden type="file" accept=".gguf,application/octet-stream" onChange={handleModelFile} />
      </Button>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
        Use a small multilingual instruct model that fits your device memory.
        The model is unloaded when Pollerama is closed or refreshed.
      </Typography>
    </Box>
  );
};

export const AISettings: React.FC = () => {
  const { aiSettings, setAISettings } = useAppContext();

  const [ollamaUrl, setOllamaUrl] = useState(DEFAULT_URL);
  const [localModel, setLocalModel] = useState(aiSettings.model || "");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);

  const addLog = (message: string) => {
    const timestamp = new Date().toISOString().slice(11, 23);
    setDebugLog((previous) => [`[${timestamp}] ${message}`, ...previous].slice(0, 30));
  };

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CONFIG_KEY);
      if (stored) {
        const config = JSON.parse(stored);
        if (config.url) {
          addLog(`Loaded saved URL: ${config.url}`);
          setOllamaUrl(config.url);
        } else {
          addLog("Saved config has no URL, using default");
        }
      } else {
        addLog(`No saved config, using default: ${DEFAULT_URL}`);
      }
    } catch (caught: any) {
      addLog(`Failed to load config: ${caught?.message}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isNative) {
      addLog("Native detected — auto-fetching models on mount");
      fetchModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchModels = async () => {
    setLoading(true);
    setError(null);
    addLog("Fetching models…");
    try {
      const response = await aiService.getModels();
      addLog(
        `Response: success=${response.success}, error=${response.error ?? "none"}, models=${
          response.data?.models?.map((item: any) => item.name).join(", ") ?? "none"
        }`,
      );
      if (response.success && response.data && Array.isArray(response.data.models)) {
        setAvailableModels(response.data.models.map((item: any) => item.name));
      } else {
        setError(response.error || "Failed to fetch models.");
      }
    } catch (caught: any) {
      addLog(`Exception: ${caught?.message}`);
      setError(caught?.message || "Failed to communicate with Ollama.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveUrl = () => {
    if (!ollamaUrl.trim()) {
      setError("Ollama URL is required");
      return;
    }
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ url: ollamaUrl.trim() }));
    aiService.updateConfig({ url: ollamaUrl.trim() });
    setAvailableModels([]);
    setLocalModel("");
    fetchModels();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveModel = () => {
    const newSettings = { model: localModel };
    setAISettings(newSettings);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newSettings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Box p={2} sx={{ bgcolor: "background.paper", color: "text.primary" }}>
      <Typography variant="h6" gutterBottom>
        AI Settings
      </Typography>

      <BrowserTranslationSettings />

      {!isNative ? (
        <Alert icon={<SmartphoneIcon />} severity="info" sx={{ mt: 3 }}>
          Summaries and writing assistance still require the native app and a
          local Ollama instance. Browser translation works with the GGUF model above.{" "}
          <Link href={ZAPSTORE_LINK} target="_blank" rel="noopener" underline="hover">
            Download from Zapstore
          </Link>
        </Alert>
      ) : (
        <>
          <Divider sx={{ my: 3 }} />
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            Ollama
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Connect to your local{" "}
            <Link href="https://ollama.com" target="_blank" rel="noopener" underline="hover">
              Ollama
            </Link>{" "}
            instance for summaries, writing assistance, and translation fallback.
          </Typography>

          <Box mt={2}>
            <TextField
              label="Ollama URL"
              fullWidth
              value={ollamaUrl}
              onChange={(event) => {
                setOllamaUrl(event.target.value);
                setSaved(false);
              }}
              margin="normal"
              placeholder="http://localhost:11434"
              helperText="URL of your local Ollama server"
            />
            <Box mt={1} display="flex" alignItems="center" gap={2}>
              <Button variant="outlined" onClick={handleSaveUrl} disabled={loading}>
                Save & Load Models
              </Button>
              {saved && (
                <Typography variant="body2" color="success.main">
                  Saved
                </Typography>
              )}
            </Box>
          </Box>

          <Box mt={3}>
            <Typography variant="subtitle1" gutterBottom>
              Ollama model
            </Typography>

            {loading ? (
              <Box mt={2} display="flex" alignItems="center">
                <CircularProgress size={20} />
                <Typography variant="body2" ml={1}>
                  Loading models from Ollama…
                </Typography>
              </Box>
            ) : availableModels.length > 0 ? (
              <>
                <TextField
                  select
                  label="Select Model"
                  fullWidth
                  value={localModel}
                  onChange={(event) => {
                    setLocalModel(event.target.value);
                    setSaved(false);
                  }}
                  margin="normal"
                >
                  {availableModels.map((modelName) => (
                    <MenuItem key={modelName} value={modelName}>
                      {modelName}
                    </MenuItem>
                  ))}
                </TextField>
                <Box mt={2} display="flex" alignItems="center" gap={2}>
                  <Button variant="contained" onClick={handleSaveModel} disabled={!localModel}>
                    Save Model
                  </Button>
                  {saved && (
                    <Typography variant="body2" color="success.main">
                      Settings saved
                    </Typography>
                  )}
                </Box>
              </>
            ) : (
              <Typography mt={2} variant="body2" color="text.secondary">
                No models loaded. Make sure Ollama is running and click Save & Load Models.
              </Typography>
            )}
          </Box>

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}

          {debugLog.length > 0 && (
            <Box mt={3}>
              <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                Debug log
              </Typography>
              <Box
                p={1}
                sx={{
                  bgcolor: "action.hover",
                  borderRadius: 1,
                  maxHeight: 160,
                  overflowY: "auto",
                  fontFamily: "monospace",
                }}
              >
                {debugLog.map((line, index) => (
                  <Typography
                    key={index}
                    variant="caption"
                    display="block"
                    sx={{ fontSize: "0.7rem", lineHeight: 1.4 }}
                  >
                    {line}
                  </Typography>
                ))}
              </Box>
            </Box>
          )}
        </>
      )}
    </Box>
  );
};
