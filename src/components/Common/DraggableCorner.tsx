import React, { useCallback, useEffect, useRef, useState } from "react";
import DraggableRaw, {
  DraggableData,
  DraggableEvent,
  DraggableProps,
} from "react-draggable";
import { Box } from "@mui/material";

const Draggable = DraggableRaw as unknown as React.ComponentClass<
  Partial<DraggableProps>
>;

export type Corner = "tl" | "tr" | "bl" | "br";

interface DraggableCornerProps {
  storageKey: string;
  defaultCorner: Corner;
  offset?: { x: number; y: number };
  zIndex?: number;
  children: (corner: Corner) => React.ReactNode;
}

const DRAG_THRESHOLD = 5;
const SNAP_MS = 220;
const IDLE_MS = 2000;
const IDLE_OPACITY = 0.35;
const FADE_MS = 280;

const isCorner = (v: string | null): v is Corner =>
  v === "tl" || v === "tr" || v === "bl" || v === "br";

const anchorLeft = (corner: Corner, offsetX: number, width: number) =>
  corner.endsWith("l") ? offsetX : window.innerWidth - offsetX - width;

const anchorTop = (corner: Corner, offsetY: number, height: number) =>
  corner.startsWith("t") ? offsetY : window.innerHeight - offsetY - height;

export const DraggableCorner: React.FC<DraggableCornerProps> = ({
  storageKey,
  defaultCorner,
  offset = { x: 16, y: 16 },
  zIndex = 1200,
  children,
}) => {
  const [corner, setCorner] = useState<Corner>(() => {
    const saved = localStorage.getItem(storageKey);
    return isCorner(saved) ? saved : defaultCorner;
  });
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [snapping, setSnapping] = useState(false);
  const [idle, setIdle] = useState(true);
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

  const transforms = snapping
    ? `transform ${SNAP_MS}ms cubic-bezier(0.2, 0.9, 0.3, 1.4)`
    : "none";

  const cornerSx: Record<string, number | string> = {
    position: "fixed",
    zIndex,
    touchAction: "none",
    opacity: idle ? IDLE_OPACITY : 1,
    transition: `${transforms}, opacity ${FADE_MS}ms ease`,
  };
  if (corner.startsWith("t")) cornerSx.top = offset.y;
  else cornerSx.bottom = offset.y;
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
    const vertical: "t" | "b" = cy < window.innerHeight / 2 ? "t" : "b";
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
