import React, { createContext, useCallback, useContext, useRef, useState } from "react";

// How many px of continuous downward scroll to fully collapse headers.
const COLLAPSE_PX = 80;

type FeedScrollCtx = {
  headerProgress: number; // 0 = fully visible, 1 = fully hidden
  /** Returns the current absolute scrollTop — safe to call inside event callbacks (reads a ref, no re-render) */
  getScrollTop: () => number;
  reportScroll: (scrollTop: number) => void;
  resetScroll: () => void;
};

const FeedScrollContext = createContext<FeedScrollCtx>({
  headerProgress: 0,
  getScrollTop: () => 0,
  reportScroll: () => {},
  resetScroll: () => {},
});

export const FeedScrollProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [offset, setOffset] = useState(0);
  const lastScrollTopRef = useRef(0);

  // Stable getter — reads the ref synchronously, causes no re-renders
  const getScrollTop = useCallback(() => lastScrollTopRef.current, []);

  const reportScroll = useCallback((scrollTop: number) => {
    const delta = scrollTop - lastScrollTopRef.current;
    lastScrollTopRef.current = scrollTop;

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
        getScrollTop,
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
