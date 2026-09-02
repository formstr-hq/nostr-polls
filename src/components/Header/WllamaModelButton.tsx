import { ChangeEvent, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Tooltip,
  Typography,
} from "@mui/material";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import { useNotification } from "../../contexts/notification-context";
import { useWllamaTranslation } from "../../hooks/useWllamaTranslation";
import { wllamaTranslationService } from "../../services/wllama-translation-service";
import { isNative } from "../../utils/platform";

export const WllamaModelButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const model = useWllamaTranslation();
  const { showNotification } = useNotification();
  const environment = wllamaTranslationService.getEnvironment();

  if (isNative) return null;

  const isLoading = model.status === "loading";
  const isReady = model.status === "ready";
  const tooltip = isLoading
    ? `Loading ${model.modelName} (${Math.round(model.progress)}%)`
    : isReady
      ? `${model.modelName} is ready for translation`
      : model.status === "error"
        ? "Translation model needs attention"
        : "Set up local translation";

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const loaded = await wllamaTranslationService.loadModel(file);
    const current = wllamaTranslationService.getSnapshot();
    if (loaded) {
      showNotification(`${current.modelName} is ready for local translation.`, "success");
    } else {
      showNotification(current.error || "Failed to load the GGUF model.", "error");
    }
  };

  const handleUnload = async () => {
    const modelName = model.modelName;
    await wllamaTranslationService.unload();
    showNotification(`${modelName || "Translation model"} unloaded.`, "info");
  };

  return (
    <>
      <Tooltip title={tooltip}>
        <IconButton
          color={isReady ? "primary" : model.status === "error" ? "error" : "inherit"}
          aria-label="Open local translation model"
          onClick={() => setOpen(true)}
        >
          {isLoading ? (
            <CircularProgress
              size={22}
              color="inherit"
              variant="determinate"
              value={model.progress}
            />
          ) : (
            <Badge color="success" variant="dot" invisible={!isReady} overlap="circular">
              <AutoFixHighIcon />
            </Badge>
          )}
        </IconButton>
      </Tooltip>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="wllama-model-dialog-title"
      >
        <DialogTitle id="wllama-model-dialog-title" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <AutoFixHighIcon color="primary" />
          Local translation model
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary">
            Choose an instruction-tuned GGUF model. Pollerama loads it locally
            with wllama, and poll text never leaves this device.
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
                color={environment.hasWebGPU ? "success" : "default"}
                label={
                  environment.hasWebGPU
                    ? "WebGPU available"
                    : "WebAssembly only"
                }
              />
            )}
          </Box>

          {!environment.success && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {environment.error || "This browser cannot run a local model."}
            </Alert>
          )}

          {isLoading && (
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, mb: 0.75 }}>
                <Typography variant="body2" noWrap>
                  Loading {model.modelName}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {Math.round(model.progress)}%
                </Typography>
              </Box>
              <LinearProgress variant="determinate" value={model.progress} />
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                Keep this tab open while the model is initialized.
              </Typography>
            </Box>
          )}

          {isReady && (
            <Alert severity="success" sx={{ mb: 2 }}>
              <strong>{model.modelName}</strong> is ready using{" "}
              {model.usedWebGPU ? "WebGPU" : "WebAssembly"}. Translation
              actions are now enabled.
            </Alert>
          )}

          {isReady && model.lastGenerationError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              <strong>The model loaded, but translation generation failed.</strong>{" "}
              {model.lastGenerationError}
            </Alert>
          )}

          {model.status === "error" && model.error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {model.error}
            </Alert>
          )}

          <Button
            component="label"
            fullWidth
            variant={isReady ? "outlined" : "contained"}
            disabled={!environment.success || isLoading}
            startIcon={<AutoFixHighIcon />}
          >
            {isReady ? "Replace GGUF model" : "Choose GGUF model"}
            <input
              hidden
              type="file"
              accept=".gguf,application/octet-stream"
              onChange={handleFile}
            />
          </Button>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            Use a small multilingual instruct model that fits your device
            memory. The selected file stays on this device.
          </Typography>
        </DialogContent>
        <DialogActions>
          {isReady && (
            <Button color="error" onClick={handleUnload}>
              Unload model
            </Button>
          )}
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
