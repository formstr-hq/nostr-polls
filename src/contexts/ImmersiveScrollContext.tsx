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
// Scrollers with less overflow than this (short lists, pill rows) are ignored.
const MIN_OVERFLOW = 240;

export const ImmersiveScrollProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hidden, setHidden] = useState(false);
  const location = useLocation();
  const last = useRef(new WeakMap<EventTarget, number>());
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
      if (node.scrollHeight - node.clientHeight < MIN_OVERFLOW) return;
      const top = node.scrollTop;
      const prev = last.current.get(node);
      last.current.set(node, top);
      if (prev === undefined) return;
      if (top < TOP_ZONE) {
        travel.current = 0;
        setHidden(false);
        return;
      }
      const delta = top - prev;
      if (delta === 0) return;
      // Reset accumulated travel when the direction flips.
      if (Math.sign(delta) !== Math.sign(travel.current)) travel.current = 0;
      travel.current += delta;
      if (travel.current > THRESHOLD) setHidden(true);
      else if (travel.current < -THRESHOLD) setHidden(false);
    };
    // Scroll events don't bubble; capture them from every scroller (Virtuoso
    // feeds, ScrollPage, profile, chat…).
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, []);

  return <ImmersiveScrollContext.Provider value={hidden}>{children}</ImmersiveScrollContext.Provider>;
};
