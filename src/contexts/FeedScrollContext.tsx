import React, { createContext, useCallback, useContext, useRef, useState } from "react";

// How many px of continuous downward scroll to fully collapse headers.
// Scrolling up any amount immediately starts revealing them again.
const COLLAPSE_PX = 80;

type FeedScrollCtx = {
  headerProgress: number; // 0 = fully visible, 1 = fully hidden
  reportScroll: (scrollTop: number) => void;
  resetScroll: () => void;
};

const FeedScrollContext = createContext<FeedScrollCtx>({
  headerProgress: 0,
  reportScroll: () => {},
  resetScroll: () => {},
});

export const FeedScrollProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // Virtual offset: 0–COLLAPSE_PX. Increases on downward scroll, decreases
  // on upward scroll. Never tied to absolute scroll position so the header
  // comes back as soon as the user scrolls up even a little.
  const [offset, setOffset] = useState(0);
  const lastScrollTopRef = useRef(0);

  const reportScroll = useCallback((scrollTop: number) => {
    const delta = scrollTop - lastScrollTopRef.current;
    lastScrollTopRef.current = scrollTop;

    // Always reset when at the very top of the feed
    if (scrollTop <= 0) {
      setOffset(0);
      return;
    }

    setOffset((prev) => Math.max(0, Math.min(COLLAPSE_PX, prev + delta)));
  }, []);

  const resetScroll = useCallback(() => {
    setOffset(0);
    lastScrollTopRef.current = 0;
  }, []);

  return (
    <FeedScrollContext.Provider
      value={{
        headerProgress: offset / COLLAPSE_PX,
        reportScroll,
        resetScroll,
      }}
    >
      {children}
    </FeedScrollContext.Provider>
  );
};

export function useFeedScroll() {
  return useContext(FeedScrollContext);
}
