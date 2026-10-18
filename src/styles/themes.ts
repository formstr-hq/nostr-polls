import { getContrastRatio, lighten } from '@mui/material/styles';

export interface FontPreset {
  id: string;
  name: string;
  fontFamily: string;
}

export interface ColorPreset {
  id: string;
  name: string;
  lightPrimary: string;
  darkPrimary: string;
  lightBg: string;
  /** Dark-mode background. All presets use OLED black (#000000). */
  darkBg: string;
  /** Accent (MUI `secondary`) colors — complements the primary; used throughout. */
  lightSecondary?: string;
  darkSecondary?: string;
  /**
   * Multi-color palettes only: six colors per mode. The first three have fixed
   * roles — [home/notes-composer, polls, selection/highlights] — and every app
   * section owns one of the six (see sectionIndex in components/Shell/navConfig),
   * so moving around the app moves through the palette. Single-color presets
   * leave this unset and use the primary color everywhere.
   */
  palette?: {
    light: string[];
    dark: string[];
  };
}

/** OLED-friendly pure black used as the dark background for every preset. */
export const OLED_BLACK = '#000000';

/**
 * Platform UI font. Native apps render in the system face; the display presets
 * below are opt-in. Kept first in FONT_PRESETS so it is both the first-run
 * default and the `getFontPreset` fallback.
 */
export const SYSTEM_FONT_ID = 'system';
export const SYSTEM_FONT_FAMILY =
  'system-ui, -apple-system, "Roboto", "Helvetica Neue", Arial, sans-serif';


export const FONT_PRESETS: FontPreset[] = [
  {
    id: SYSTEM_FONT_ID,
    name: 'System',
    fontFamily: SYSTEM_FONT_FAMILY,
  },
  {
    id: 'shantell',
    name: 'Pollerama',
    fontFamily: '"Shantell Sans", sans-serif',
  },
  {
    id: 'fredoka',
    name: 'Fredoka',
    fontFamily: '"Fredoka Variable", sans-serif',
  },
  {
    id: 'comfortaa',
    name: 'Comfortaa',
    fontFamily: '"Comfortaa Variable", sans-serif',
  },
  {
    id: 'raleway',
    name: 'Raleway',
    fontFamily: '"Raleway Variable", sans-serif',
  },
];

/**
 * Multi-color palettes (Color Block). Each content type owns a color: notes and
 * general screens use the first, polls the second, and selection/highlights the
 * third. Listed after the single-color presets in Appearance settings.
 */
export const PALETTE_PRESETS: ColorPreset[] = [
  {
    id: 'festival',
    name: 'Festival',
    lightPrimary: '#F4B400',
    darkPrimary: '#FFD24A',
    lightBg: '#f2f2ef',
    darkBg: OLED_BLACK,
    lightSecondary: '#5B5BD6',
    darkSecondary: '#8B8BFF',
    palette: {
      light: ['#F4B400', '#FF5A5F', '#5B5BD6', '#00A88F', '#E84393', '#FF8A00'],
      dark: ['#FFD24A', '#FF7A7E', '#8B8BFF', '#2EE6C3', '#FF6FB5', '#FFA940'],
    },
  },
  {
    id: 'lagoon',
    name: 'Lagoon',
    lightPrimary: '#0FA3B1',
    darkPrimary: '#3FE0EC',
    lightBg: '#f2f2ef',
    darkBg: OLED_BLACK,
    lightSecondary: '#B07A00',
    darkSecondary: '#FFCA4D',
    palette: {
      light: ['#0FA3B1', '#3D5AFE', '#FFB400', '#7C4DFF', '#00BFA5', '#FF6E40'],
      dark: ['#3FE0EC', '#7C8CFF', '#FFCA4D', '#B39DFF', '#3FF2CF', '#FF9E7A'],
    },
  },
  {
    id: 'orchard',
    name: 'Orchard',
    lightPrimary: '#2BB673',
    darkPrimary: '#5CE39A',
    lightBg: '#f2f2ef',
    darkBg: OLED_BLACK,
    lightSecondary: '#C2185B',
    darkSecondary: '#FF6FA0',
    palette: {
      light: ['#2BB673', '#FF7A1A', '#E0457B', '#F2C230', '#8E5CD9', '#1E9BD7'],
      dark: ['#5CE39A', '#FF9A4D', '#FF6FA0', '#FFD95A', '#B58CFF', '#5CC8FF'],
    },
  },
  {
    // The full spectrum: every section a different hue.
    id: 'prism',
    name: 'Prism',
    lightPrimary: '#FF3D71',
    darkPrimary: '#FF6B93',
    lightBg: '#f2f2ef',
    darkBg: OLED_BLACK,
    lightSecondary: '#5E35B1',
    darkSecondary: '#B388FF',
    palette: {
      light: ['#FF3D71', '#FF9F1C', '#7B2FF7', '#00C2A8', '#2D7FF9', '#C6E000'],
      dark: ['#FF6B93', '#FFB84D', '#A66BFF', '#2EE8CF', '#5E9EFF', '#DBF53D'],
    },
  },
];

/**
 * Single-color presets were retired in favour of palettes. Users who had one
 * picked (or a custom theme) move to the palette closest in mood.
 */
const LEGACY_PRESET_TO_PALETTE: Record<string, string> = {
  golden: 'festival',
  ember: 'festival',
  ocean: 'lagoon',
  cyberpunk: 'lagoon',
  forest: 'orchard',
  dusk: 'prism',
  midnight: 'prism',
  crimson: 'prism',
  custom: 'festival',
};

/** Id of the user's own palette ("Make your own"). */
export const CUSTOM_PALETTE_ID = 'mine';

/** What each of the six palette slots paints (see sectionIndex in navConfig). */
export const PALETTE_SLOT_LABELS = [
  'Home',
  'Polls',
  'Highlights',
  'Notes & Messages',
  'Explore & Settings',
  'Profile & Games',
];

/** Starting colors for a brand-new custom palette. */
export const DEFAULT_CUSTOM_PALETTE = ['#F4B400', '#FF5A5F', '#5B5BD6', '#00A88F', '#E84393', '#FF8A00'];

/**
 * Build a palette from six user-picked colors. Dark mode uses the same hues,
 * lifted where needed so they still glow on OLED black.
 */
export function buildCustomPalette(colors: string[]): ColorPreset {
  const light = DEFAULT_CUSTOM_PALETTE.map((d, i) => colors[i] || d);
  const dark = light.map((c) => (getContrastRatio(c, '#000000') < 7 ? lighten(c, 0.32) : c));
  return {
    id: CUSTOM_PALETTE_ID,
    name: 'Mine',
    lightPrimary: light[0],
    darkPrimary: dark[0],
    lightBg: '#f2f2ef',
    darkBg: OLED_BLACK,
    lightSecondary: light[2],
    darkSecondary: dark[2],
    palette: { light, dark },
  };
}

/** Palette id for a stored preference, migrating retired single-color ids. */
export function resolvePaletteId(id: string | null | undefined): string {
  if (id === CUSTOM_PALETTE_ID) return id;
  if (id && PALETTE_PRESETS.some((p) => p.id === id)) return id;
  return (id && LEGACY_PRESET_TO_PALETTE[id]) || DEFAULT_COLOR_PRESET_ID;
}

/** Palette shown to brand-new installs. */
export const DEFAULT_COLOR_PRESET_ID = 'festival';

export function getFontPreset(id: string): FontPreset {
  return FONT_PRESETS.find(f => f.id === id) ?? FONT_PRESETS[0];
}

export function getColorPreset(id: string): ColorPreset {
  const resolved = resolvePaletteId(id);
  return PALETTE_PRESETS.find((c) => c.id === resolved) ?? PALETTE_PRESETS[0];
}
