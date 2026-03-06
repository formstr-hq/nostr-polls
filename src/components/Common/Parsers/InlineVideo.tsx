import React, { useEffect, useRef } from "react";
import { Box, Typography } from "@mui/material";
import { useVideoPlayer } from "../../../contexts/VideoPlayerContext";

/** Walk up the DOM to find the nearest element that actually scrolls. */
function findScrollContainer(el: Element): Element | null {
  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    const { overflow, overflowY } = window.getComputedStyle(parent);
    if (/(auto|scroll)/.test(overflow + overflowY)) return parent;
    parent = parent.parentElement;
  }
  return null;
}

/**
 * A <video> element that automatically pops into the floating mini-player when it
 * is playing and the user scrolls it completely out of view.
 */
export const InlineVideo: React.FC<{ src: string }> = ({ src }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isPlayingRef = useRef(false);

  const { setFloatingVideo, floatingVideo } = useVideoPlayer();
  const isThisFloating =
    floatingVideo?.type === "video" && floatingVideo.url === src;

  // Auto-float when playing and fully scrolled out of view.
  // We use the nearest scrollable ancestor as the observer root so the check
  // works inside Virtuoso's scroll container (body never scrolls in this app).
  useEffect(() => {
    if (!wrapperRef.current) return;

    const root = findScrollContainer(wrapperRef.current);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting && isPlayingRef.current) {
          const time = videoRef.current?.currentTime ?? 0;
          videoRef.current?.pause();
          setFloatingVideo({ type: "video", url: src, startTime: time });
        }
      },
      { threshold: 0, root }
    );

    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, [src, setFloatingVideo]);

  if (isThisFloating) {
    return (
      <Box
        ref={wrapperRef}
        sx={{
          width: "100%",
          aspectRatio: "16/9",
          bgcolor: "#111",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 1,
          my: 0.5,
        }}
      >
        <Typography variant="caption" color="text.secondary">
          ▶ Playing in mini player
        </Typography>
      </Box>
    );
  }

  return (
    <div ref={wrapperRef}>
      <video
        ref={videoRef}
        src={src}
        controls
        style={{ maxWidth: "100%", marginBottom: "0.5rem", maxHeight: "400px" }}
        onPlay={() => { isPlayingRef.current = true; }}
        onPause={() => { isPlayingRef.current = false; }}
        onEnded={() => { isPlayingRef.current = false; }}
      />
    </div>
  );
};
