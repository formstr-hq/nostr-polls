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
}

/** OLED-friendly pure black used as the dark background for every preset. */
export const OLED_BLACK = '#000000';

/** Neutral light background used for custom themes (matches the warm-grey presets). */
export const DEFAULT_LIGHT_BG = '#f5f4f1';

export const FONT_PRESETS: FontPreset[] = [
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

// Every preset now uses OLED black in dark mode, so the dedicated "-noir"
// variants (which only differed by having a black dark background) became
// duplicates: amber-noir vs golden (gold) and steel-noir vs ocean (blue) were
// dropped, and crimson-noir was renamed to plain "Crimson".
export const COLOR_PRESETS: ColorPreset[] = [
  {
    id: 'golden',
    name: 'Golden',
    lightPrimary: '#DAA520',
    darkPrimary: '#FAD13F',
    lightBg: '#f5f4f1',
    darkBg: OLED_BLACK,
    // Warm amber-bronze — stays in the golden-hour family.
    lightSecondary: '#B45309',
    darkSecondary: '#F0A93B',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    lightPrimary: '#0277bd',
    darkPrimary: '#40c4ff',
    lightBg: '#f0f4f8',
    darkBg: OLED_BLACK,
    // Sea-green/aqua — the shallows of the same ocean.
    lightSecondary: '#0E7490',
    darkSecondary: '#22D3EE',
  },
  {
    id: 'forest',
    name: 'Forest',
    lightPrimary: '#2e7d32',
    darkPrimary: '#69f0ae',
    lightBg: '#f1f8f1',
    darkBg: OLED_BLACK,
    // Bark/earth brown — the woodland floor beneath the canopy.
    lightSecondary: '#92400E',
    darkSecondary: '#D9A066',
  },
  {
    id: 'dusk',
    name: 'Dusk',
    lightPrimary: '#6a1b9a',
    darkPrimary: '#e040fb',
    lightBg: '#f5f0f8',
    darkBg: OLED_BLACK,
    // Twilight rose — the warm glow on the horizon at dusk.
    lightSecondary: '#BE185D',
    darkSecondary: '#F472B6',
  },
  {
    id: 'ember',
    name: 'Ember',
    lightPrimary: '#d84315',
    darkPrimary: '#ff6d00',
    lightBg: '#fff5f0',
    darkBg: OLED_BLACK,
    // Flame gold — the bright tips of a glowing ember.
    lightSecondary: '#B45309',
    darkSecondary: '#FBBF24',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    lightPrimary: '#000000',
    darkPrimary: '#ffffff',
    lightBg: '#ffffff',
    darkBg: OLED_BLACK,
    // Deep night-sky indigo — the only color in the monochrome theme.
    lightSecondary: '#3730A3',
    darkSecondary: '#818CF8',
  },
  {
    id: 'crimson',
    name: 'Crimson',
    lightPrimary: '#8e1d2b',
    darkPrimary: '#e35d6a',
    lightBg: '#f7f5f3',
    darkBg: OLED_BLACK,
    // Regal gold — the classic companion to deep crimson.
    lightSecondary: '#B8860B',
    darkSecondary: '#E0B84A',
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    lightPrimary: '#00875a',
    darkPrimary: '#00ff9f',
    lightBg: '#f4fff9',
    darkBg: OLED_BLACK,
    lightSecondary: '#d6006e',
    darkSecondary: '#ff2a6d',
  },
];

export function getFontPreset(id: string): FontPreset {
  return FONT_PRESETS.find(f => f.id === id) ?? FONT_PRESETS[0];
}

export function getColorPreset(id: string): ColorPreset {
  return COLOR_PRESETS.find(c => c.id === id) ?? COLOR_PRESETS[0];
}

/** Id of the user-defined "make your own" theme. */
export const CUSTOM_PRESET_ID = 'custom';

/** Fallback colors for a brand-new custom theme (before the user picks any). */
export const DEFAULT_CUSTOM_PRIMARY = '#7c4dff';
export const DEFAULT_CUSTOM_SECONDARY = '#00bcd4';

// A ColorPreset from two user-chosen colors. The same primary/secondary are used in
// both light and dark mode (the user picks the hue; the background stays neutral
// light / OLED black). Keeps the "make your own" UI to just two swatches.
export function buildCustomPreset(primary: string, secondary: string): ColorPreset {
  return {
    id: CUSTOM_PRESET_ID,
    name: 'Custom',
    lightPrimary: primary,
    darkPrimary: primary,
    lightBg: DEFAULT_LIGHT_BG,
    darkBg: OLED_BLACK,
    lightSecondary: secondary,
    darkSecondary: secondary,
  };
}
