import React, { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/CloseRounded";
import PhotoCameraIcon from "@mui/icons-material/PhotoCameraRounded";
import jsQR from "jsqr";

interface QrScannerDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the decoded payload. The caller decides what to open. */
  onResult: (value: string) => void;
}

async function decodeImageFile(file: File): Promise<string | null> {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  let source: CanvasImageSource | null = null;
  let width = 0;
  let height = 0;
  let objectUrl: string | null = null;

  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file);
      source = bitmap;
      width = bitmap.width;
      height = bitmap.height;
    } else {
      objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      source = image;
      width = image.naturalWidth;
      height = image.naturalHeight;
    }

    if (!source || width === 0 || height === 0) return null;
    canvas.width = width;
    canvas.height = height;
    context.drawImage(source, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    return jsQR(imageData.data, width, height, { inversionAttempts: "attemptBoth" })
      ?.data ?? null;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (source && "close" in source && typeof source.close === "function") {
      source.close();
    }
  }
}

/**
 * Camera QR scanner with a photo-picker fallback. Uses getUserMedia + jsQR
 * rather than a native plugin, so it works in the Android WebView and on the
 * web without another Capacitor dependency. The Android manifest declares
 * CAMERA, and Capacitor grants the WebView's VIDEO_CAPTURE request.
 */
export default function QrScannerDialog({
  open,
  onClose,
  onResult,
}: QrScannerDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraUnavailable, setCameraUnavailable] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let frame = 0;
    let lastScan = 0;

    setError(null);
    setStarting(true);
    setCameraUnavailable(false);

    const stopStream = () => {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };

    const start = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;

      if (!navigator.mediaDevices?.getUserMedia) {
        setStarting(false);
        setCameraUnavailable(true);
        setError("Live camera scanning isn't available here. Choose a photo instead.");
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stopStream();
          return;
        }
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        await video.play();
        setStarting(false);

        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          setError("Couldn't start the camera preview.");
          return;
        }

        const tick = (now: number) => {
          if (cancelled) return;
          const width = video.videoWidth;
          const height = video.videoHeight;
          if (width > 0 && height > 0 && now - lastScan > 160) {
            lastScan = now;
            canvas.width = width;
            canvas.height = height;
            context.drawImage(video, 0, 0, width, height);
            const imageData = context.getImageData(0, 0, width, height);
            const code = jsQR(imageData.data, width, height, {
              inversionAttempts: "attemptBoth",
            });
            if (code?.data) {
              cancelled = true;
              stopStream();
              navigator.vibrate?.(40);
              onResultRef.current(code.data);
              return;
            }
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch (err) {
        if (cancelled) return;
        setStarting(false);
        setCameraUnavailable(true);
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setError("Camera permission was denied. Allow camera access or choose a photo.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setError("No camera found. Choose a photo instead.");
        } else {
          setError("Couldn't start the camera. Choose a photo instead.");
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stopStream();
    };
  }, [open]);

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const value = await decodeImageFile(file);
      if (value) {
        onResultRef.current(value);
      } else {
        setError("No QR code found in that image. Try another photo.");
      }
    } catch {
      setError("Couldn't read that image. Try another photo.");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        Scan a QR code
        <IconButton size="small" onClick={onClose} aria-label="Close scanner">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        <Box
          sx={{
            position: "relative",
            width: "100%",
            aspectRatio: "1 / 1",
            borderRadius: "20px",
            overflow: "hidden",
            bgcolor: "black",
            mb: 2,
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: starting || cameraUnavailable ? "none" : "block",
            }}
          />
          {(starting || cameraUnavailable) && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1.5,
                color: "common.white",
                p: 3,
                textAlign: "center",
              }}
            >
              {starting ? (
                <>
                  <CircularProgress color="inherit" size={28} />
                  <Typography variant="body2">Starting camera…</Typography>
                </>
              ) : (
                <Typography variant="body2">
                  Use a photo of the QR code instead.
                </Typography>
              )}
            </Box>
          )}
          {!starting && !cameraUnavailable && (
            <Box
              aria-hidden
              sx={{
                position: "absolute",
                inset: "18%",
                border: "2px solid rgba(255,255,255,0.85)",
                borderRadius: "18px",
                boxShadow: "0 0 0 999px rgba(0,0,0,0.18)",
                pointerEvents: "none",
              }}
            />
          )}
        </Box>

        <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ mb: 2 }}>
          Point the camera at a Pollerama profile QR, or pick a photo from your gallery.
        </Typography>

        {error && (
          <Typography variant="body2" color="error" textAlign="center" sx={{ mb: 2 }}>
            {error}
          </Typography>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={handleFile}
        />
        <Button
          fullWidth
          variant="outlined"
          startIcon={<PhotoCameraIcon />}
          onClick={() => fileInputRef.current?.click()}
        >
          Choose a photo
        </Button>
        <canvas ref={canvasRef} style={{ display: "none" }} />
      </DialogContent>
    </Dialog>
  );
}
