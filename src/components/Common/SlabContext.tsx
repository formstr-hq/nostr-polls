import { createContext, useContext } from "react";

/**
 * Color Block: feed items are rounded "slabs". Anything rendered inside a slab
 * (a quoted note, an embedded poll) reads this to draw itself as an inner
 * surface instead of another slab.
 */
export const SlabContext = createContext(false);
export const useInsideSlab = () => useContext(SlabContext);

/** sx for a feed-level slab, or for an item nested inside one. */
export const slabSx = (nested: boolean) => ({
  mx: nested ? 0 : { xs: 1.25, sm: 1 },
  mt: nested ? 1 : 1.25,
  mb: nested ? 0 : 0,
  border: 0,
  borderRadius: nested ? "18px" : "26px",
  bgcolor: nested ? "cb.inner" : "cb.slab",
  boxShadow: "none",
  overflow: "hidden",
});

/** sx for a list rendered as one slab (rows separated by hairlines). */
export const slabListSx = {
  mx: { xs: 1.25, sm: 1 },
  mt: 1.25,
  borderRadius: "24px",
  bgcolor: "cb.slab",
  overflow: "hidden",
} as const;
