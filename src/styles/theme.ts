import {alpha, createTheme, darken, lighten} from "@mui/material/styles";
import {Theme} from "@mui/system/createTheme";
import {CSSObject} from "@mui/material";
import {ColorPreset} from "./themes";

// ── Color Block tokens ──────────────────────────────────────────────────────
// The design system (see designs/app): a solid "block" of the theme color holds
// whatever is in focus, content sits on rounded "slabs" over a neutral page, and
// secondary chrome is near-black "ink". Exposed as `theme.palette.cb` so any
// component can reach them via sx paths such as `bgcolor: "cb.block"`.
export interface ColorBlockTokens {
  /** Block color for notes / general screens. */
  block: string;
  onBlock: string;
  /** Block color for polls (differs from `block` only in multi-color palettes). */
  poll: string;
  onPoll: string;
  /** Selection, unread and highlight color. */
  selection: string;
  onSelection: string;
  /** Bright variant of the block color, readable on ink/black surfaces. */
  accent: string;
  accentPoll: string;
  /** Neutral page behind slabs. */
  page: string;
  /** Content surface. */
  slab: string;
  /** Surface nested inside a slab (poll options, inputs). */
  inner: string;
  /** Near-black chrome (nav dock, mini player). */
  ink: string;
  onInk: string;
  /** Translucent fill for controls sitting on the block. */
  onBlockTint: string;
  /**
   * One color per app section (6 for palettes; the single preset color repeated
   * for single-color presets). See sectionIndex in components/Shell/navConfig.
   */
  sections: string[];
  /** Readable text/icon color on each section color. */
  onSections: string[];
  /** Bright variant of each section color, for use on ink/black surfaces. */
  sectionAccents: string[];
  /** How blocks are painted: flat, blended into the next color, or metallic. */
  finish: BlockFinish;
}

export const BLOCK_FINISHES = ["solid", "gradient", "aurora", "holographic", "metallic", "glossy"] as const;
export type BlockFinish = (typeof BLOCK_FINISHES)[number];

/**
 * CSS `background` for a block painted with palette color `i`. Multi-color
 * finishes pull in the following palette colors, which is what makes palettes
 * feel like a color explosion; single-color presets get tints of their color.
 */
export function blockFill(sections: string[], i: number, finish: BlockFinish): string {
  const n = sections.length;
  const c = sections[i % n];
  let next = sections[(i + 1) % n];
  let next2 = sections[(i + 2) % n];
  if (next === c) {
    // Single-color preset: derive companions from the color itself.
    next = darken(c, 0.32);
    next2 = lighten(c, 0.3);
  }
  switch (finish) {
    case "gradient":
      return `linear-gradient(125deg, ${c} 0%, ${c} 35%, ${next} 115%)`;
    case "aurora":
      // Soft glows of the neighbouring palette colors drifting over the base.
      return [
        `radial-gradient(85% 130% at 100% 0%, ${next} 0%, ${alpha(next, 0)} 62%)`,
        `radial-gradient(70% 120% at 35% 135%, ${next2} 0%, ${alpha(next2, 0)} 62%)`,
        c,
      ].join(", ");
    case "holographic":
      // Iridescent foil: a palette conic sweep under a pearly light band.
      return [
        "linear-gradient(115deg, rgba(255,255,255,0) 18%, rgba(255,255,255,0.38) 30%, rgba(190,230,255,0.22) 38%, rgba(255,190,240,0.22) 46%, rgba(255,255,255,0) 58%)",
        `conic-gradient(from 200deg at 72% 28%, ${c}, ${next}, ${next2}, ${c})`,
      ].join(", ");
    case "metallic": {
      // Brushed metal: alternating light/dark bands plus a fine diagonal grain.
      const hi = lighten(c, 0.42);
      const mid = lighten(c, 0.16);
      const lo = darken(c, 0.22);
      return [
        "repeating-linear-gradient(100deg, rgba(255,255,255,0.05) 0 2px, rgba(0,0,0,0.035) 2px 4px)",
        `linear-gradient(115deg, ${lo} 0%, ${mid} 18%, ${hi} 30%, ${c} 46%, ${lo} 64%, ${mid} 80%, ${hi} 92%, ${c} 100%)`,
      ].join(", ");
    }
    case "glossy":
      // Candy gloss: a bright highlight across the top half.
      return [
        "linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.14) 40%, rgba(255,255,255,0) 52%, rgba(0,0,0,0.08) 100%)",
        c,
      ].join(", ");
    default:
      return c;
  }
}

declare module "@mui/material/styles" {
  interface Palette {
    cb: ColorBlockTokens;
  }
  interface PaletteOptions {
    cb?: ColorBlockTokens;
  }
}

const luminance = (hex: string) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/** Ink or white, whichever reads better on `bg`. */
export const onColor = (bg: string) => (luminance(bg) > 0.3 ? "#141414" : "#ffffff");

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * The block color made safe for text and icons on the page: darkened in light
 * mode / lightened in dark mode only as much as needed for 3:1 contrast. Blocks
 * keep the vivid color (cb.block); MUI's `primary` uses this readable one.
 */
export const readableOn = (color: string, mode: "light" | "dark") => {
  const bg = mode === "dark" ? "#000000" : "#ffffff";
  let c = color;
  for (let i = 0; i < 12 && contrast(c, bg) < 3; i++) {
    c = mode === "dark" ? lighten(c, 0.12) : darken(c, 0.1);
  }
  return c;
};

export function colorBlockTokens(
  preset: ColorPreset,
  mode: "light" | "dark",
  finish: BlockFinish = "solid"
): ColorBlockTokens {
  const dark = mode === "dark";
  const pal = preset.palette;
  const single = dark ? preset.darkPrimary : preset.lightPrimary;
  const sections = pal ? (dark ? pal.dark : pal.light) : Array(6).fill(single);
  const sectionAccents = pal ? pal.dark : Array(6).fill(preset.darkPrimary);
  const [c1, c2, c3] = sections;
  const [d1, d2] = sectionAccents;
  return {
    sections,
    onSections: sections.map(onColor),
    sectionAccents,
    finish,
    block: c1,
    onBlock: onColor(c1),
    poll: c2,
    onPoll: onColor(c2),
    selection: c3,
    onSelection: onColor(c3),
    accent: d1,
    accentPoll: d2,
    page: dark ? "#000000" : "#f2f2ef",
    slab: dark ? "#141414" : "#ffffff",
    inner: dark ? "#1f1f1f" : "#f4f4f1",
    ink: dark ? "#1c1c1c" : "#141414",
    onInk: "#ffffff",
    onBlockTint: "rgba(0,0,0,0.13)",
  };
}

export const getColorsWithTheme = (theme: Theme, styles: CSSObject, contrast: CSSObject = {}) => {
  const contrastStyles = Object.keys(styles).reduce<CSSObject>((map, key) => {
    map[key] = contrast[key] || theme.palette.getContrastText(styles[key])
    return map
  }, {})
  return {
    ...theme.applyStyles('light', styles),
    ...theme.applyStyles('dark', contrastStyles)
  }
}

export function buildTheme(fontFamily: string, preset: ColorPreset, finish: BlockFinish = "solid") {
  const light = colorBlockTokens(preset, "light", finish);
  const dark = colorBlockTokens(preset, "dark", finish);
  const lightSecondary = readableOn(preset.lightSecondary ?? "#757575", "light");
  const darkSecondary = readableOn(preset.darkSecondary ?? "#bdbdbc", "dark");
  const lightPrimary = readableOn(light.block, "light");
  const darkPrimary = readableOn(dark.block, "dark");

  return createTheme({
    typography: {
      fontFamily,
      h4: { fontWeight: 900, letterSpacing: "-0.03em" },
      h5: { fontWeight: 900, letterSpacing: "-0.03em" },
      h6: { fontWeight: 800, letterSpacing: "-0.02em" },
    },
    shape: { borderRadius: 14 },
    colorSchemes: {
      dark: {
        palette: {
          mode: "dark",
          primary: { main: darkPrimary, contrastText: onColor(darkPrimary) },
          secondary: { main: darkSecondary },
          background: { default: dark.page, paper: dark.slab },
          cb: dark,
        },
      },
      light: {
        palette: {
          primary: { main: lightPrimary, contrastText: onColor(lightPrimary) },
          secondary: { main: lightSecondary },
          background: { default: light.page, paper: light.slab },
          cb: light,
        },
      }
    },
    palette: {
      mode: "light",
      primary: { main: lightPrimary, contrastText: onColor(lightPrimary) },
      secondary: { main: lightSecondary },
      background: { default: light.page, paper: light.slab },
      cb: light,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: (theme) => ({
          body: {
            backgroundColor: theme.palette.cb.page,
          }
        })
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: "50px",
            textTransform: "none",
            fontWeight: 700,
          },
          contained: {
            boxShadow: "none",
            "&:hover": { boxShadow: "none" },
          },
          text: ({ theme }) => ({
            color: theme.palette.text.primary,
            '&:hover': {
              backgroundColor: theme.palette.action.hover,
            },
          }),
          outlined: ({ theme }) => ({
            color: theme.palette.text.primary,
            borderColor: theme.palette.divider,
            borderWidth: 1.5,
            '&:hover': {
              backgroundColor: theme.palette.action.hover,
              borderColor: theme.palette.text.secondary,
              borderWidth: 1.5,
            },
          }),
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundColor: theme.palette.cb.block,
            color: theme.palette.cb.onBlock,
            boxShadow: "none",
          }),
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none" },
          rounded: { borderRadius: 22 },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 26,
            backgroundColor: theme.palette.cb.slab,
            border: "none",
          }),
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: 28 },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: { borderRadius: 18 },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 12, fontWeight: 600 },
        },
      },
      MuiModal: {
        styleOverrides: {
          root: {
            overflowY: "auto",
          },
        },
      },
      MuiFab: {
        defaultProps: {
          color: "primary",
        },
        styleOverrides: {
          root: { boxShadow: "0 14px 28px -12px rgba(0,0,0,0.5)" },
        },
      },
      // Inline links pick up the secondary accent.
      MuiLink: {
        styleOverrides: {
          root: ({ theme }) => ({
            color: theme.palette.secondary.main,
            textDecorationColor: theme.palette.secondary.main,
          }),
        },
      },
      MuiTabs: {
        defaultProps: {
          indicatorColor: "secondary",
          textColor: "secondary",
        },
      },
      MuiTab: {
        styleOverrides: {
          root: { textTransform: "none", fontWeight: 700 },
        },
      },
      MuiSwitch: {
        defaultProps: { color: "secondary" },
      },
      MuiSlider: {
        defaultProps: { color: "secondary" },
      },
      MuiCircularProgress: {
        defaultProps: { color: "secondary" },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: 14 },
        },
      },
      MuiAvatar: {
        styleOverrides: {
          root: {
            overflow: "hidden",
            "& > *:not(img)": {
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            },
          },
          fallback: {
            width: "75%",
            height: "75%",
          },
        },
      },
    },
  });
}
