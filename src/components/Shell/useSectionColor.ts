import { useTheme } from "@mui/material";
import { useLocation } from "react-router-dom";
import { blockFill, ColorBlockTokens } from "../../styles/theme";
import { sectionIndex } from "./navConfig";

export interface SectionColor {
  index: number;
  /** Base color of the section (for solid fills, borders, text accents). */
  color: string;
  /** Readable text/icon color on it. */
  on: string;
  /** Bright variant for use on ink/black surfaces. */
  accent: string;
  /** CSS `background` honoring the user's finish (solid / gradient / metallic). */
  fill: string;
}

/** Color for palette index `index` (wraps), with the current finish applied. */
export function useSectionColorAt(index: number): SectionColor {
  return sectionColorFrom(useTheme().palette.cb, index);
}

/** The current route's section color — what the block header and Create use. */
export function useSectionColor(): SectionColor {
  const { pathname, search } = useLocation();
  return useSectionColorAt(sectionIndex(pathname, search));
}

/** Non-hook variant for rendering many differently-colored items in a loop. */
export function sectionColorFrom(cb: ColorBlockTokens, index: number): SectionColor {
  const n = cb.sections.length;
  const i = ((index % n) + n) % n;
  return {
    index: i,
    color: cb.sections[i],
    on: cb.onSections[i],
    accent: cb.sectionAccents[i],
    fill: blockFill(cb.sections, i, cb.finish),
  };
}
