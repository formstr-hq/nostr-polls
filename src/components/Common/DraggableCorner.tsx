import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import DraggableRaw, {
  DraggableData,
  DraggableEvent,
  DraggableProps,
} from "react-draggable";
import { Box } from "@mui/material";

const Draggable = DraggableRaw as unknown as React.ComponentClass<
  Partial<DraggableProps>
>;

// l/r = left/right edge. First char is the vertical band: t = top, m = vertical
// middle of the edge, b = bottom.
export type Corner = "tl" | "tr" | "ml" | "mr" | "bl" | "br";

interface DraggableCornerProps {
  storageKey: string;
  defaultCorner: Corner;
  offset?: { x: number; y: number };
  zIndex?: number;
  /** When true, keep the element fully opaque (skip the idle fade-out). */
  disableIdle?: boolean;
  /**
   * CSS selector (within this component) for the element that initiates a drag.
   * Without it, the whole wrapper is draggable — and wrappers like SpeedDial
   * reserve large empty padding areas that then hijack scroll gestures.
   */
  handle?: string;
  children: (corner: Corner) => React.ReactNode;
}

const DRAG_THRESHOLD = 5;
const SNAP_MS = 220;
const IDLE_MS = 2000;
const IDLE_OPACITY = 0.35;
const FADE_MS = 280;

const isCorner = (v: string | null): v is Corner =>
  v === "tl" || v === "tr" || v === "ml" || v === "mr" || v === "bl" || v === "br";

const anchorLeft = (corner: Corner, offsetX: number, width: number) =>
  corner.endsWith("l") ? offsetX : window.innerWidth - offsetX - width;

const anchorTop = (corner: Corner, offsetY: number, height: number) =>
  corner.startsWith("t")
    ? offsetY
    : corner.startsWith("b")
      ? window.innerHeight - offsetY - height
      : Math.round((window.innerHeight - height) / 2);

export const DraggableCorner: React.FC<DraggableCornerProps> = ({
  storageKey,
  defaultCorner,
  offset = { x: 16, y: 16 },
  zIndex = 1200,
  disableIdle = false,
  handle,
  children,
}) => {
  const [corner, setCorner] = useState<Corner>(() => {
    const saved = localStorage.getItem(storageKey);
    return isCorner(saved) ? saved : defaultCorner;
  });
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [snapping, setSnapping] = useState(false);
  const [idle, setIdle] = useState(true);
  // Measured node height — needed to vertically center the mid-edge rest
  // positions (ml/mr). A new object each time guarantees a re-render on resize
  // so the center recomputes against the new window height.
  const [nodeSize, setNodeSize] = useState<{ height: number }>({ height: 0 });
  const nodeRef = useRef<HTMLDivElement>(null!);
  const wasDragged = useRef(false);
  const idleTimer = useRef<number | null>(null);

  const wake = useCallback(() => {
    setIdle(false);
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
  }, []);

  useEffect(() => {
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
    return () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    };
  }, []);

  useLayoutEffect(() => {
    const measure = () => {
      const el = nodeRef.current;
      if (el) setNodeSize({ height: el.offsetHeight });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const transforms = snapping
    ? `transform ${SNAP_MS}ms cubic-bezier(0.2, 0.9, 0.3, 1.4)`
    : "none";

  const cornerSx: Record<string, number | string> = {
    position: "fixed",
    zIndex,
    touchAction: "none",
    opacity: idle && !disableIdle ? IDLE_OPACITY : 1,
    transition: `${transforms}, opacity ${FADE_MS}ms ease`,
  };
  if (corner.startsWith("t")) cornerSx.top = offset.y;
  else if (corner.startsWith("b")) cornerSx.bottom = offset.y;
  else cornerSx.top = Math.round((window.innerHeight - nodeSize.height) / 2);
  if (corner.endsWith("l")) cornerSx.left = offset.x;
  else cornerSx.right = offset.x;

  const onStart = () => {
    wasDragged.current = false;
    wake();
  };

  const onDrag = (_e: DraggableEvent, data: DraggableData) => {
    setPosition({ x: data.x, y: data.y });
    if (Math.abs(data.x) > DRAG_THRESHOLD || Math.abs(data.y) > DRAG_THRESHOLD) {
      wasDragged.current = true;
    }
    wake();
  };

  const onStop = () => {
    if (!wasDragged.current) {
      setPosition({ x: 0, y: 0 });
      return;
    }
    const rect = nodeRef.current?.getBoundingClientRect();
    if (!rect) {
      setPosition({ x: 0, y: 0 });
      return;
    }

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const horizontal: "l" | "r" = cx < window.innerWidth / 2 ? "l" : "r";
    // Top / middle / bottom thirds → t / m / b
    const third = window.innerHeight / 3;
    const vertical: "t" | "m" | "b" = cy < third ? "t" : cy < 2 * third ? "m" : "b";
    const newCorner = `${vertical}${horizontal}` as Corner;

    const currLeft = anchorLeft(corner, offset.x, rect.width);
    const currTop = anchorTop(corner, offset.y, rect.height);
    const nextLeft = anchorLeft(newCorner, offset.x, rect.width);
    const nextTop = anchorTop(newCorner, offset.y, rect.height);

    setSnapping(true);
    setPosition({ x: nextLeft - currLeft, y: nextTop - currTop });

    window.setTimeout(() => {
      setSnapping(false);
      setCorner(newCorner);
      setPosition({ x: 0, y: 0 });
      if (newCorner !== corner) localStorage.setItem(storageKey, newCorner);
    }, SNAP_MS);

    const suppress = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener("click", suppress, true);
    window.setTimeout(() => window.removeEventListener("click", suppress, true), 100);
  };

  return (
    <Draggable
      nodeRef={nodeRef}
      position={position}
      onStart={onStart}
      onDrag={onDrag}
      onStop={onStop}
      handle={handle}
      allowMobileScroll
    >
      <Box
        ref={nodeRef}
        sx={cornerSx}
        onPointerEnter={wake}
        onPointerDown={wake}
        onPointerMove={wake}
        onTouchStart={wake}
        onTouchMove={wake}
        onMouseEnter={wake}
      >
        {children(corner)}
      </Box>
    </Draggable>
  );
};
