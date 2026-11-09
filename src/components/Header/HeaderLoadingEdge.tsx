import React, { useEffect, useId, useRef, useState } from "react";

const RADIUS = 30; // matches the header's bottom corner radius
const OFFSET = 7; // gap between the header edge and the line, on the page background
const STROKE = 2.5;
const FADE = 40; // px at each end where the line melts into the corners
const PERIOD_S = 3.4;

interface Props {
  /** The header element this line traces. */
  target: HTMLElement | null;
  active: boolean;
  /** Line color; should read on the page background. */
  color: string;
}

/**
 * Loader for the block header: a thin line that follows the header's curved
 * bottom edge from just outside it, with a long comet that loops continuously.
 * Draws in the page-background gap under the header, so it needs the header to
 * stay `position: relative` and not clip its overflow.
 */
const HeaderLoadingEdge: React.FC<Props> = ({ target, active, color }) => {
  const uid = useId().replace(/:/g, "");
  const reduceMotion =
    typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Stay mounted while fading out, then drop the SMIL animation entirely.
  const [mounted, setMounted] = useState(active);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!target) return;
    const measure = () => setSize({ w: target.clientWidth, h: target.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(target);
    return () => ro.disconnect();
  }, [target]);

  useEffect(() => {
    if (active) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    const svg = svgRef.current;
    if (!svg) {
      setMounted(false);
      return;
    }
    // Never cut a pass short: if loading ends mid-cycle, let the comet finish
    // the cycle it's on (the animation clock starts when the svg mounts), then
    // fade out. If loading restarts meanwhile, this is cancelled and it keeps going.
    const elapsed = svg.getCurrentTime?.() ?? 0;
    const remainingMs = reduceMotion ? 0 : (PERIOD_S - (elapsed % PERIOD_S)) * 1000;
    let unmount: ReturnType<typeof setTimeout>;
    const fade = setTimeout(() => {
      setVisible(false);
      unmount = setTimeout(() => setMounted(false), 400);
    }, remainingMs);
    return () => {
      clearTimeout(fade);
      clearTimeout(unmount);
    };
  }, [active, reduceMotion]);

  const { w, h } = size;
  if (!mounted || w === 0 || h === 0) return null;

  const r = RADIUS + OFFSET;
  const d =
    `M ${-OFFSET} ${h - RADIUS} A ${r} ${r} 0 0 0 ${RADIUS} ${h + OFFSET} ` +
    `L ${w - RADIUS} ${h + OFFSET} A ${r} ${r} 0 0 0 ${w + OFFSET} ${h - RADIUS}`;
  const gw = w * 0.95;
  const e = Math.min(FADE / w, 0.45);

  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      viewBox={`0 0 ${w} ${h + OFFSET + STROKE}`}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: "100%",
        height: h + OFFSET + STROKE,
        overflow: "visible",
        pointerEvents: "none",
        zIndex: 5,
        opacity: visible ? 1 : 0,
        transition: "opacity .35s ease",
      }}
    >
      <defs>
        <linearGradient id={`${uid}-fade`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={w} y2={0}>
          <stop offset={0} stopColor="#fff" stopOpacity={0} />
          <stop offset={e} stopColor="#fff" stopOpacity={1} />
          <stop offset={1 - e} stopColor="#fff" stopOpacity={1} />
          <stop offset={1} stopColor="#fff" stopOpacity={0} />
        </linearGradient>
        <mask id={`${uid}-mask`} maskUnits="userSpaceOnUse" x={-30} y={-30} width={w + 60} height={h + 90}>
          <rect x={0} y={-30} width={w} height={h + 90} fill={`url(#${uid}-fade)`} />
        </mask>
        <linearGradient id={`${uid}-comet`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={gw} y2={0}>
          <stop offset={0} stopColor={color} stopOpacity={0} />
          <stop offset={0.36} stopColor={color} stopOpacity={0.55} />
          <stop offset={0.46} stopColor={color} stopOpacity={1} />
          <stop offset={0.54} stopColor={color} stopOpacity={1} />
          <stop offset={0.64} stopColor={color} stopOpacity={0.55} />
          <stop offset={1} stopColor={color} stopOpacity={0} />
          {!reduceMotion && (
            <animateTransform
              attributeName="gradientTransform"
              type="translate"
              from={`${-gw} 0`}
              to={`${w} 0`}
              dur={`${PERIOD_S}s`}
              repeatCount="indefinite"
            />
          )}
        </linearGradient>
      </defs>
      <g mask={`url(#${uid}-mask)`}>
        <path d={d} fill="none" stroke={color} strokeWidth={STROKE} opacity={0.2} />
        {!reduceMotion && (
          <path d={d} fill="none" stroke={`url(#${uid}-comet)`} strokeWidth={STROKE} strokeLinecap="round" />
        )}
      </g>
    </svg>
  );
};

export default HeaderLoadingEdge;
