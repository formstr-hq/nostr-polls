import React, { createContext, useCallback, useContext, useState } from "react";

export type FloatingVideo = {
  type: "video" | "youtube";
  url: string;
  startTime: number;
};

type VideoPlayerCtx = {
  floatingVideo: FloatingVideo | null;
  setFloatingVideo: (v: FloatingVideo) => void;
  clearFloating: () => void;
};

const VideoPlayerContext = createContext<VideoPlayerCtx>({
  floatingVideo: null,
  setFloatingVideo: () => {},
  clearFloating: () => {},
});

export const VideoPlayerProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [floatingVideo, setFloatingVideoState] = useState<FloatingVideo | null>(null);

  const setFloatingVideo = useCallback((v: FloatingVideo) => {
    setFloatingVideoState(v);
  }, []);

  const clearFloating = useCallback(() => {
    setFloatingVideoState(null);
  }, []);

  return (
    <VideoPlayerContext.Provider value={{ floatingVideo, setFloatingVideo, clearFloating }}>
      {children}
    </VideoPlayerContext.Provider>
  );
};

export function useVideoPlayer() {
  return useContext(VideoPlayerContext);
}
