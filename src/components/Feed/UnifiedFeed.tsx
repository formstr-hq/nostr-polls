import React, { useCallback, useEffect, useRef } from "react";
import { Box, CircularProgress, Fab, LinearProgress } from "@mui/material";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { useNotification } from "../../contexts/notification-context";
import useTopicExplorerScroll from "../../hooks/useTopicExplorerScroll";
import PullToRefresh from "../Common/PullToRefresh";
import { useFeedActions } from "../../contexts/FeedActionsContext";

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

  // Pull-to-refresh (immersive mode only)
  onRefresh?: () => Promise<void> | void;
  /** Called when user reaches the bottom — use to poll for newer posts */
  onRefreshNewer?: () => void;
  /** Show a subtle refreshing indicator (e.g. thin progress bar at top) */
  refreshing?: boolean;

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
  onRefresh,
  onRefreshNewer,
  refreshing,
  headerContent,
  followOutput,
  virtuosoRef: externalVirtuosoRef,
}: UnifiedFeedProps<T>) {
  const internalVirtuosoRef = useRef<VirtuosoHandle | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { showNotification } = useNotification();
  // Ref to the Virtuoso scroller element — used by PullToRefresh to check scrollTop
  const virtuosoScrollerRef = useRef<HTMLElement | null>(null);
  // Scroll state reported up to the SpeedDial via context
  const scrolledDownRef = useRef(false);
  const { reportScrollState, reportNewItems } = useFeedActions();

  const virtuosoRef = (externalVirtuosoRef ?? internalVirtuosoRef) as React.RefObject<VirtuosoHandle>;

  const isEmbedded = !!customScrollParent;
  const isNested = !!scrollContainerRef;
  const isImmersive = !isEmbedded && !isNested;

  const scrollToTopFn = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: 0, behavior: "smooth" });
  }, [virtuosoRef]);

  const handleScroll = useCallback((e: React.UIEvent) => {
    const scrollTop = (e.target as HTMLElement).scrollTop;
    const isDown = scrollTop > 300;
    if (isDown !== scrolledDownRef.current) {
      scrolledDownRef.current = isDown;
      if (isImmersive) reportScrollState(isDown, scrollToTopFn);
    }
  }, [isImmersive, reportScrollState, scrollToTopFn]);

  // When user reaches the bottom: paginate older posts AND poll for newer ones
  const handleEndReached = useCallback(() => {
    onEndReached?.();
    onRefreshNewer?.();
  }, [onEndReached, onRefreshNewer]);

  // Immersive feeds surface their buffered "new items" through the SpeedDial
  // (CreateFAB) rather than a floating button, so report the count up.
  useEffect(() => {
    if (!isImmersive) return;
    reportNewItems(newItemCount ?? 0, newItemLabel, () => onShowNewItems?.());
  }, [isImmersive, newItemCount, newItemLabel, onShowNewItems, reportNewItems]);

  // Clear the count when this feed unmounts so a stale badge doesn't linger.
  useEffect(() => {
    return () => {
      if (isImmersive) reportNewItems(0, newItemLabel, () => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      return <Box sx={{ minHeight: "200px" }} />;
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

  const feedContent = (
    <>
      <div ref={containerRef} style={{ height: "100%", position: "relative" }}>
        {(refreshing || loading || loadingMore) && (
          <LinearProgress
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              zIndex: 10,
              height: 2,
            }}
          />
        )}
        {headerContent}
        {showLoading ? (
          <Box sx={{ minHeight: "200px" }} />
        ) : showEmpty ? (
          <>{emptyState}</>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={data}
            itemContent={itemContent}
            {...computeKeyProp}
            style={{ height: "100%" }}
            endReached={handleEndReached}
            startReached={onStartReached}
            followOutput={followOutput}
            increaseViewportBy={{ top: 400, bottom: 600 }}
            defaultItemHeight={380}
            scrollerRef={(el) => { virtuosoScrollerRef.current = el as HTMLElement | null; }}
            onScroll={isImmersive ? handleScroll : undefined}
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

      {/* Immersive feeds show new items via the SpeedDial; the floating button
          is only for embedded/nested feeds that have no SpeedDial. */}
      {!isImmersive && newItemCount != null && newItemCount > 0 && onShowNewItems && (
        <Fab
          variant="extended"
          size="small"
          color="primary"
          aria-label={`${newItemCount} new ${newItemLabel}`}
          onClick={() => {
            onShowNewItems();
            showNotification(`Added ${newItemCount} new ${newItemLabel} to the feed`, "success", 2500);
          }}
          sx={{
            position: "fixed",
            right: 16,
            top: "50%",
            transform: "translateY(-50%)",
            borderRadius: 2,
            px: 1.5,
            fontSize: "0.75rem",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          +{newItemCount} {newItemLabel}
        </Fab>
      )}

      {/* Scroll-to-top is now handled by the SpeedDial in CreateFAB via FeedActionsContext */}
    </>
  );

  // Wrap immersive feeds with pull-to-refresh when a handler is provided
  if (isImmersive && onRefresh) {
    return (
      <PullToRefresh onRefresh={onRefresh} scrollRef={virtuosoScrollerRef}>
        {feedContent}
      </PullToRefresh>
    );
  }

  return feedContent;
}

export default UnifiedFeed;
