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
  darkBg: string;
}

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

export const COLOR_PRESETS: ColorPreset[] = [
  {
    id: 'golden',
    name: 'Golden',
    lightPrimary: '#DAA520',
    darkPrimary: '#FAD13F',
    lightBg: '#f5f4f1',
    darkBg: '#3d3d3d',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    lightPrimary: '#0277bd',
    darkPrimary: '#40c4ff',
    lightBg: '#f0f4f8',
    darkBg: '#102030',
  },
  {
    id: 'forest',
    name: 'Forest',
    lightPrimary: '#2e7d32',
    darkPrimary: '#69f0ae',
    lightBg: '#f1f8f1',
    darkBg: '#1a2a1a',
  },
  {
    id: 'dusk',
    name: 'Dusk',
    lightPrimary: '#6a1b9a',
    darkPrimary: '#e040fb',
    lightBg: '#f5f0f8',
    darkBg: '#1a1030',
  },
  {
    id: 'ember',
    name: 'Ember',
    lightPrimary: '#d84315',
    darkPrimary: '#ff6d00',
    lightBg: '#fff5f0',
    darkBg: '#2d1a0a',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    lightPrimary: '#000000',
    darkPrimary: '#ffffff',
    lightBg: '#ffffff',
    darkBg: '#000000',
  },
  {
    id: 'crimson-noir',
    name: 'Crimson Noir',
    lightPrimary: '#8e1d2b',
    darkPrimary: '#e35d6a',
    lightBg: '#f7f5f3',
    darkBg: '#000000',
  },
  {
    id: 'steel-noir',
    name: 'Steel Noir',
    lightPrimary: '#2f4a63',
    darkPrimary: '#7fa6c4',
    lightBg: '#f4f6f8',
    darkBg: '#000000',
  },
  {
    id: 'amber-noir',
    name: 'Amber Noir',
    lightPrimary: '#8a5a12',
    darkPrimary: '#d9a441',
    lightBg: '#f7f5f0',
    darkBg: '#000000',
  },
];

export function getFontPreset(id: string): FontPreset {
  return FONT_PRESETS.find(f => f.id === id) ?? FONT_PRESETS[0];
}

export function getColorPreset(id: string): ColorPreset {
  return COLOR_PRESETS.find(c => c.id === id) ?? COLOR_PRESETS[0];
}
