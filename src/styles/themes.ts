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
  /** Optional accent (MUI `secondary`) colors; default to neutral grey. */
  lightSecondary?: string;
  darkSecondary?: string;
}

/** OLED-friendly pure black used as the dark background for every preset. */
const OLED_BLACK = '#000000';

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
  },
  {
    id: 'ocean',
    name: 'Ocean',
    lightPrimary: '#0277bd',
    darkPrimary: '#40c4ff',
    lightBg: '#f0f4f8',
    darkBg: OLED_BLACK,
  },
  {
    id: 'forest',
    name: 'Forest',
    lightPrimary: '#2e7d32',
    darkPrimary: '#69f0ae',
    lightBg: '#f1f8f1',
    darkBg: OLED_BLACK,
  },
  {
    id: 'dusk',
    name: 'Dusk',
    lightPrimary: '#6a1b9a',
    darkPrimary: '#e040fb',
    lightBg: '#f5f0f8',
    darkBg: OLED_BLACK,
  },
  {
    id: 'ember',
    name: 'Ember',
    lightPrimary: '#d84315',
    darkPrimary: '#ff6d00',
    lightBg: '#fff5f0',
    darkBg: OLED_BLACK,
  },
  {
    id: 'midnight',
    name: 'Midnight',
    lightPrimary: '#000000',
    darkPrimary: '#ffffff',
    lightBg: '#ffffff',
    darkBg: OLED_BLACK,
  },
  {
    id: 'crimson',
    name: 'Crimson',
    lightPrimary: '#8e1d2b',
    darkPrimary: '#e35d6a',
    lightBg: '#f7f5f3',
    darkBg: OLED_BLACK,
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
