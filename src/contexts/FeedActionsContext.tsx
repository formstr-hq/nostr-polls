import React, { createContext, useCallback, useContext, useRef, useState } from "react";

interface FeedActionsCtx {
  isScrolledDown: boolean;
  scrollToTop: () => void;
  /** Called by the active feed to register its scroll state + scroll-to-top function */
  reportScrollState: (isDown: boolean, fn: () => void) => void;
  /** Called by the active feed to register its refresh function */
  registerRefresh: (fn: () => void) => void;
  /** Calls the currently registered refresh function */
  refresh: () => void;
  /** Number of newer items the active feed has buffered but not yet shown */
  newItemCount: number;
  /** Noun for the buffered items, e.g. "notes" / "polls" */
  newItemLabel: string;
  /** Merges the active feed's buffered new items into view */
  showNewItems: () => void;
  /** Called by the active feed to report its buffered new-item count + merge fn */
  reportNewItems: (count: number, label: string, fn: () => void) => void;
}

const FeedActionsContext = createContext<FeedActionsCtx>({
  isScrolledDown: false,
  scrollToTop: () => {},
  reportScrollState: () => {},
  registerRefresh: () => {},
  refresh: () => {},
  newItemCount: 0,
  newItemLabel: "posts",
  showNewItems: () => {},
  reportNewItems: () => {},
});

export const FeedActionsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isScrolledDown, setIsScrolledDown] = useState(false);
  const [newItemCount, setNewItemCount] = useState(0);
  const [newItemLabel, setNewItemLabel] = useState("posts");
  const scrollFnRef = useRef<() => void>(() => {});
  const refreshFnRef = useRef<() => void>(() => {});
  const showNewItemsFnRef = useRef<() => void>(() => {});

  const scrollToTop = useCallback(() => scrollFnRef.current(), []);
  const refresh = useCallback(() => refreshFnRef.current(), []);
  const showNewItems = useCallback(() => showNewItemsFnRef.current(), []);

  const reportScrollState = useCallback((isDown: boolean, fn: () => void) => {
    scrollFnRef.current = fn;
    setIsScrolledDown((prev) => (prev !== isDown ? isDown : prev));
  }, []);

  const registerRefresh = useCallback((fn: () => void) => {
    refreshFnRef.current = fn;
  }, []);

  const reportNewItems = useCallback((count: number, label: string, fn: () => void) => {
    showNewItemsFnRef.current = fn;
    setNewItemCount((prev) => (prev !== count ? count : prev));
    setNewItemLabel((prev) => (prev !== label ? label : prev));
  }, []);

  return (
    <FeedActionsContext.Provider
      value={{
        isScrolledDown,
        scrollToTop,
        reportScrollState,
        registerRefresh,
        refresh,
        newItemCount,
        newItemLabel,
        showNewItems,
        reportNewItems,
      }}
    >
      {children}
    </FeedActionsContext.Provider>
  );
};

export const useFeedActions = () => useContext(FeedActionsContext);
