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

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
    _YTLoading?: boolean;
    _YTLoaded?: boolean;
    _YTCallbacks?: Array<() => void>;
  }
}

export type YouTubePlayerProps = {
  url: string;
  /** Seek to this time (seconds) on ready — used by the floating mini-player */
  startTime?: number;
  /** True when rendered inside FloatingVideoPlayer — disables float-out behaviour */
  isFloating?: boolean;
};

function extractVideoId(url: string): string | null {
  const regExp = /(?:youtube\.com\/.*v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regExp);
  return match?.[1] ?? null;
}

function loadYouTubeAPI(): Promise<void> {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) { resolve(); return; }
    if (window._YTLoading) { window._YTCallbacks!.push(resolve); return; }

    window._YTLoading = true;
    window._YTCallbacks = [resolve];

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(tag);

    window.onYouTubeIframeAPIReady = () => {
      window._YTLoaded = true;
      window._YTLoading = false;
      window._YTCallbacks!.forEach((cb) => cb());
      window._YTCallbacks = [];
    };
  });
}

export const YouTubePlayer: React.FC<YouTubePlayerProps> = ({
  url,
  startTime = 0,
  isFloating = false,
}) => {
  const playerDivRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const ytPlayer = useRef<any>(null);
  const isPlayingRef = useRef(false);

  const { setFloatingVideo, floatingVideo } = useVideoPlayer();

  // Show placeholder when this URL is currently in the mini-player (and we're not the mini-player)
  const isThisFloating =
    !isFloating &&
    floatingVideo?.type === "youtube" &&
    floatingVideo.url === url;

  // Create / destroy the YT.Player instance
  useEffect(() => {
    if (isThisFloating) {
      // Destroy any live player so it doesn't fight the mini-player
      ytPlayer.current?.destroy();
      ytPlayer.current = null;
      return;
    }

    const videoId = extractVideoId(url);
    if (!videoId) return;

    let cancelled = false;

    loadYouTubeAPI().then(() => {
      if (cancelled || !playerDivRef.current) return;

      ytPlayer.current = new window.YT.Player(playerDivRef.current, {
        width: "100%",
        height: "100%",
        videoId,
        playerVars: {
          start: Math.floor(startTime),
          autoplay: isFloating ? 1 : 0,
          playsinline: 1,
        },
        events: {
          onReady: (event: any) => {
            // Fine-grained seek for fractional seconds
            if (startTime > 0) event.target.seekTo(startTime, true);
            if (isFloating) event.target.playVideo();
          },
          onStateChange: (event: any) => {
            // YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
            isPlayingRef.current = event.data === 1;
          },
        },
      });
    });

    return () => {
      cancelled = true;
      ytPlayer.current?.destroy();
      ytPlayer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, isFloating, isThisFloating]);

  // Auto-float when playing and scrolled completely out of view.
  // Use the nearest scrollable ancestor as root so the check works inside
  // Virtuoso's scroll container (body never scrolls in this app).
  useEffect(() => {
    if (isFloating || !wrapperRef.current) return;

    const root = findScrollContainer(wrapperRef.current);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting && isPlayingRef.current) {
          const time = ytPlayer.current?.getCurrentTime?.() ?? 0;
          setFloatingVideo({ type: "youtube", url, startTime: time });
        }
      },
      { threshold: 0, root }
    );

    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, [url, isFloating, setFloatingVideo]);

  if (isThisFloating) {
    return (
      <Box
        ref={wrapperRef}
        sx={{
          width: "100%",
          maxWidth: "1000px",
          margin: "0 auto",
          aspectRatio: "16/9",
          bgcolor: "#111",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 1,
        }}
      >
        <Typography variant="caption" color="text.secondary">
          ▶ Playing in mini player
        </Typography>
      </Box>
    );
  }

  return (
    <div
      ref={wrapperRef}
      style={{
        width: "100%",
        maxWidth: "1000px",
        margin: "0 auto",
        aspectRatio: "16/9",
      }}
    >
      <div
        ref={playerDivRef}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
};
