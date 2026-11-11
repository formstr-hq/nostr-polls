import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

// Immersive scrolling (Color Block shell): the block header and the floating
// nav dock get out of the way while you scroll down through content and come
// back as soon as you scroll up, reach the top, or change page — replacing the
// old "hide the sidebar" toggle.
const ImmersiveScrollContext = createContext(false);

/** True while chrome should be hidden for immersive scrolling. */
export const useImmersiveHidden = () => useContext(ImmersiveScrollContext);

// How far (px) you must keep scrolling in one direction before chrome toggles,
// so small jitters and momentum wobble don't flicker it.
const THRESHOLD = 24;
// Scrolled this close to the top, chrome always shows.
const TOP_ZONE = 48;
// Scrollers with less overflow than this (short lists, pill rows, a lone note
// page) are ignored. Hiding the header makes the scroller taller, so a scroller
// with less overflow than the header's height couldn't be scrolled sensibly.
const MIN_OVERFLOW = 360;
// Don't start hiding this close to the bottom. Collapsing the header grows the
// scroller by the header's height, which lowers the maximum scroll position; if
// we're within that distance of the end the browser clamps scrollTop, the clamp
// reads as a big scroll-up, the chrome comes back, and it oscillates.
const BOTTOM_GUARD = 180;

interface ScrollSnapshot {
  top: number;
  scrollHeight: number;
  clientHeight: number;
}

export const ImmersiveScrollProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hidden, setHidden] = useState(false);
  const location = useLocation();
  const last = useRef(new WeakMap<EventTarget, ScrollSnapshot>());
  const travel = useRef(0);

  // A new page always starts with the chrome visible.
  useEffect(() => {
    setHidden(false);
    travel.current = 0;
  }, [location.pathname]);

  useEffect(() => {
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement | Document;
      const node = el instanceof Document ? el.scrollingElement : el;
      if (!(node instanceof HTMLElement)) return;
      const { scrollHeight, clientHeight, scrollTop: top } = node;
      if (scrollHeight - clientHeight < MIN_OVERFLOW) return;
      const prev = last.current.get(node);
      last.current.set(node, { top, scrollHeight, clientHeight });
      if (prev === undefined) return;
      // The scroller was resized (chrome sliding in/out, content loading). The
      // browser may have clamped scrollTop as a result — that's layout, not the
      // user scrolling, so it must not count as travel in either direction.
      if (prev.scrollHeight !== scrollHeight || prev.clientHeight !== clientHeight) {
        travel.current = 0;
        return;
      }
      if (top < TOP_ZONE) {
        travel.current = 0;
        setHidden(false);
        return;
      }
      const delta = top - prev.top;
      if (delta === 0) return;
      // Reset accumulated travel when the direction flips.
      if (Math.sign(delta) !== Math.sign(travel.current)) travel.current = 0;
      travel.current += delta;
      if (travel.current > THRESHOLD) {
        if (scrollHeight - clientHeight - top >= BOTTOM_GUARD) setHidden(true);
      } else if (travel.current < -THRESHOLD) {
        setHidden(false);
      }
    };
    // Scroll events don't bubble; capture them from every scroller (Virtuoso
    // feeds, ScrollPage, profile, chat…).
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, []);

  return <ImmersiveScrollContext.Provider value={hidden}>{children}</ImmersiveScrollContext.Provider>;
};
