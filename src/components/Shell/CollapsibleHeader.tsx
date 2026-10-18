import React, { useLayoutEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { useImmersiveHidden } from "../../contexts/ImmersiveScrollContext";

/**
 * Slides the block header up out of the way during immersive scrolling. It's
 * pulled up by its own height (measured), so the content below grows into the
 * space instead of being covered.
 */
const CollapsibleHeader: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const hidden = useImmersiveHidden();
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    setHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  return (
    <Box sx={{ overflow: "hidden" }}>
      <Box
        ref={ref}
        aria-hidden={hidden || undefined}
        sx={{
          mt: hidden ? `-${height}px` : 0,
          transition: "margin-top .28s cubic-bezier(.2,0,0,1)",
          "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        }}
      >
        {children}
      </Box>
    </Box>
  );
};

export default CollapsibleHeader;
