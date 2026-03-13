import React, { createContext, useContext } from "react";

// FeedScrollContext is kept as a no-op stub.
// The collapsing header animation has been removed in favour of a static
// AppBar + side-pane navigation, so nothing here does real work anymore.
// The API is preserved so existing callers (NotesFeed, TopicsFeed, etc.) do
// not need to be touched — they just receive harmless default values.

type FeedScrollCtx = {
  headerProgress: number;
  getScrollTop: () => number;
  reportScroll: (scrollTop: number) => void;
  resetScroll: () => void;
};

const noop = () => {};

const FeedScrollContext = createContext<FeedScrollCtx>({
  headerProgress: 0,
  getScrollTop: () => 0,
  reportScroll: noop,
  resetScroll: noop,
});

export const FeedScrollProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <FeedScrollContext.Provider
    value={{ headerProgress: 0, getScrollTop: () => 0, reportScroll: noop, resetScroll: noop }}
  >
    {children}
  </FeedScrollContext.Provider>
);

export function useFeedScroll() {
  return useContext(FeedScrollContext);
}
