import React, { useRef } from "react";
import { Box, CircularProgress, Fab } from "@mui/material";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import useTopicExplorerScroll from "../../hooks/useTopicExplorerScroll";
import { useFeedScroll } from "../../contexts/FeedScrollContext";

interface UnifiedFeedProps<T> {
  // Data
  data: T[];
  itemContent: (index: number, item: T) => React.ReactNode;
  computeItemKey?: (index: number, item: T) => string | number;

  // Scroll mode (only one should be set)
  customScrollParent?: HTMLElement; // embedded (profile feeds)
  scrollContainerRef?: React.RefObject<HTMLElement | null>; // nested (topic explorer)
  // neither = immersive (default)

  // Pagination
  onEndReached?: () => void;
  onStartReached?: () => void;

  // Loading
  loading?: boolean; // full-page loader (replaces list)
  loadingMore?: boolean; // footer spinner

  // Empty state
  emptyState?: React.ReactNode;

  // New items FAB
  newItemCount?: number;
  onShowNewItems?: () => void;
  newItemLabel?: string;

  // Content above Virtuoso inside the scroll container
  headerContent?: React.ReactNode;

  // Virtuoso passthrough
  followOutput?: boolean;
  virtuosoRef?: React.RefObject<VirtuosoHandle | null>;
}

function UnifiedFeed<T>({
  data,
  itemContent,
  computeItemKey,
  customScrollParent,
  scrollContainerRef,
  onEndReached,
  onStartReached,
  loading,
  loadingMore,
  emptyState,
  newItemCount,
  onShowNewItems,
  newItemLabel = "posts",
  headerContent,
  followOutput,
  virtuosoRef: externalVirtuosoRef,
}: UnifiedFeedProps<T>) {
  const internalVirtuosoRef = useRef<VirtuosoHandle | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const virtuosoRef = (externalVirtuosoRef ?? internalVirtuosoRef) as React.RefObject<VirtuosoHandle>;

  const isEmbedded = !!customScrollParent;
  const isNested = !!scrollContainerRef;
  const isImmersive = !isEmbedded && !isNested;

  const { reportScroll, resetScroll } = useFeedScroll();

  // Only active in nested (topic explorer) mode
  useTopicExplorerScroll(
    isNested ? containerRef : { current: null },
    isNested ? virtuosoRef : { current: null },
    isNested ? scrollContainerRef! : { current: null },
  );

  // Only pass computeItemKey when provided — Virtuoso v4 calls it unconditionally,
  // so passing undefined overrides the internal default and crashes.
  const computeKeyProp = computeItemKey ? { computeItemKey } : {};

  const showLoading = loading && data.length === 0;
  const showEmpty = !loading && data.length === 0 && emptyState;

  // Embedded mode: no container div, no scroll hooks — early returns are safe.
  if (isEmbedded) {
    if (showLoading) {
      return (
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            minHeight: "200px",
          }}
        >
          <CircularProgress />
        </Box>
      );
    }
    if (showEmpty) {
      return <>{emptyState}</>;
    }
    return (
      <Virtuoso
        ref={virtuosoRef}
        data={data}
        itemContent={itemContent}
        {...computeKeyProp}
        customScrollParent={customScrollParent}
        endReached={onEndReached}
        startReached={onStartReached}
        followOutput={followOutput}
        components={{
          Footer: () =>
            loadingMore ? (
              <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
                <CircularProgress size={24} />
              </Box>
            ) : null,
        }}
      />
    );
  }

  // Immersive or nested mode: the container div must ALWAYS mount so that
  // scroll hooks can attach their listeners to it.
  return (
    <>
      <div ref={containerRef} style={{ height: "100%" }}>
        {headerContent}
        {showLoading ? (
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              minHeight: "200px",
            }}
          >
            <CircularProgress />
          </Box>
        ) : showEmpty ? (
          <>{emptyState}</>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={data}
            itemContent={itemContent}
            {...computeKeyProp}
            style={{ height: "100%" }}
            endReached={onEndReached}
            startReached={onStartReached}
            followOutput={followOutput}
            increaseViewportBy={{ top: 3000, bottom: 400 }}
            defaultItemHeight={350}
            onScroll={
              isImmersive
                ? (e) => reportScroll(e.currentTarget.scrollTop)
                : undefined
            }
            components={{
              Footer: () =>
                loadingMore ? (
                  <Box
                    sx={{ display: "flex", justifyContent: "center", p: 2 }}
                  >
                    <CircularProgress size={24} />
                  </Box>
                ) : null,
            }}
          />
        )}
      </div>

      {newItemCount != null && newItemCount > 0 && onShowNewItems && (
        <Fab
          variant="extended"
          color="primary"
          aria-label={`new ${newItemLabel}`}
          onClick={() => {
            onShowNewItems();
            // Wait for React to commit the new items into the list, then jump to top.
            // setTimeout(0) yields after the current synchronous work and scheduled
            // microtasks so the state update is committed before we scroll.
            setTimeout(() => {
              virtuosoRef.current?.scrollToIndex({ index: 0, behavior: "smooth" });
              resetScroll(); // re-show the header
            }, 0);
          }}
          sx={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
          }}
        >
          <KeyboardArrowUpIcon sx={{ mr: 0.5 }} />
          {newItemCount} new {newItemLabel}
        </Fab>
      )}
    </>
  );
}

export default UnifiedFeed;
