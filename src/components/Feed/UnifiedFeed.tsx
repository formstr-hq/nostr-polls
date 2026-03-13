import React, { useRef } from "react";
import { Box, CircularProgress, Fab } from "@mui/material";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { useNotification } from "../../contexts/notification-context";
import useTopicExplorerScroll from "../../hooks/useTopicExplorerScroll";
import PullToRefresh from "../Common/PullToRefresh";

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
  headerContent,
  followOutput,
  virtuosoRef: externalVirtuosoRef,
}: UnifiedFeedProps<T>) {
  const internalVirtuosoRef = useRef<VirtuosoHandle | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { showNotification } = useNotification();
  // Ref to the Virtuoso scroller element — used by PullToRefresh to check scrollTop
  const virtuosoScrollerRef = useRef<HTMLElement | null>(null);

  const virtuosoRef = (externalVirtuosoRef ?? internalVirtuosoRef) as React.RefObject<VirtuosoHandle>;

  const isEmbedded = !!customScrollParent;
  const isNested = !!scrollContainerRef;
  const isImmersive = !isEmbedded && !isNested;

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

  const feedContent = (
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
            increaseViewportBy={{ top: 400, bottom: 600 }}
            defaultItemHeight={380}
            scrollerRef={(el) => { virtuosoScrollerRef.current = el as HTMLElement | null; }}
            onScroll={undefined}
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
