import React, { useRef, useState } from "react";
import { Box, IconButton, Paper } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import { useVideoPlayer } from "../../contexts/VideoPlayerContext";
import { YouTubePlayer } from "./Youtube";

export const FloatingVideoPlayer: React.FC = () => {
  const { floatingVideo, clearFloating } = useVideoPlayer();
  const containerRef = useRef<HTMLDivElement>(null);
  // Start bottom-right, above any potential bottom nav
  const [pos, setPos] = useState({ right: 16, bottom: 80 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startRight: number;
    startBottom: number;
  } | null>(null);

  const onDragStart = (clientX: number, clientY: number) => {
    dragRef.current = {
      startX: clientX,
      startY: clientY,
      startRight: pos.right,
      startBottom: pos.bottom,
    };
  };

  const onDragMove = (clientX: number, clientY: number) => {
    if (!dragRef.current) return;
    const dx = clientX - dragRef.current.startX;
    const dy = clientY - dragRef.current.startY;
    setPos({
      right: Math.max(0, dragRef.current.startRight - dx),
      bottom: Math.max(0, dragRef.current.startBottom - dy),
    });
  };

  const onDragEnd = () => {
    dragRef.current = null;
  };

  // Mouse drag
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    onDragStart(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => onDragMove(ev.clientX, ev.clientY);
    const onUp = () => {
      onDragEnd();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Touch drag
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    onDragStart(t.clientX, t.clientY);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0];
    onDragMove(t.clientX, t.clientY);
  };

  if (!floatingVideo) return null;

  return (
    <Paper
      ref={containerRef}
      elevation={8}
      sx={{
        position: "fixed",
        right: pos.right,
        bottom: pos.bottom,
        width: 300,
        zIndex: 9999,
        borderRadius: 2,
        overflow: "hidden",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}
    >
      {/* Drag handle */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 0.5,
          py: 0.25,
          bgcolor: "background.paper",
          cursor: "grab",
          "&:active": { cursor: "grabbing" },
          userSelect: "none",
          touchAction: "none",
        }}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onDragEnd}
      >
        <DragIndicatorIcon sx={{ fontSize: 18, opacity: 0.5 }} />
        <IconButton size="small" onClick={clearFloating} sx={{ p: 0.25 }}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>

      {/* Player */}
      <Box sx={{ width: "100%", aspectRatio: "16/9", bgcolor: "#000" }}>
        {floatingVideo.type === "youtube" ? (
          <YouTubePlayer
            url={floatingVideo.url}
            startTime={floatingVideo.startTime}
            isFloating
          />
        ) : (
          <video
            key={floatingVideo.url}
            src={floatingVideo.url}
            autoPlay
            controls
            style={{ width: "100%", height: "100%", display: "block" }}
            onLoadedMetadata={(e) => {
              (e.currentTarget as HTMLVideoElement).currentTime =
                floatingVideo.startTime;
            }}
          />
        )}
      </Box>
    </Paper>
  );
};
