import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ColorPreset,
  getFontPreset,
  getColorPreset,
  resolvePaletteId,
  buildCustomPalette,
  CUSTOM_PALETTE_ID,
  DEFAULT_CUSTOM_PALETTE,
  PALETTE_PRESETS,
  SYSTEM_FONT_ID,
  DEFAULT_COLOR_PRESET_ID,
} from '../styles/themes';
import { BLOCK_FINISHES, type BlockFinish } from '../styles/theme';

interface AppearanceContextType {
  fontPresetId: string;
  /** Id of the selected multi-color palette. */
  colorPresetId: string;
  /** The resolved palette for the current selection. */
  colorPreset: ColorPreset;
  setFontPreset: (id: string) => void;
  setColorPreset: (id: string) => void;
  /** The six colors of the user's own palette ("Make your own"). */
  customPalette: string[];
  /** Save the user's palette and switch to it. */
  setCustomPalette: (colors: string[]) => void;
  /** How Color Block blocks are painted (solid / gradient / aurora / …). */
  finish: BlockFinish;
  setFinish: (finish: BlockFinish) => void;
}

const AppearanceContext = createContext<AppearanceContextType>({
  fontPresetId: SYSTEM_FONT_ID,
  colorPresetId: DEFAULT_COLOR_PRESET_ID,
  colorPreset: PALETTE_PRESETS[0],
  setFontPreset: () => {},
  setColorPreset: () => {},
  customPalette: DEFAULT_CUSTOM_PALETTE,
  setCustomPalette: () => {},
  finish: 'solid',
  setFinish: () => {},
});

const FINISH_KEY = 'pollerama:blockFinish';
const PALETTE_KEY = 'pollerama:colorPreset';
const CUSTOM_PALETTE_KEY = 'pollerama:customPalette';

function readCustomPalette(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_PALETTE_KEY) || 'null');
    if (Array.isArray(parsed) && parsed.every((c) => typeof c === 'string')) return parsed;
  } catch {
    /* fall through to the default */
  }
  return DEFAULT_CUSTOM_PALETTE;
}

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [fontPresetId, setFontPresetId] = useState(() => {
    const stored = localStorage.getItem('pollerama:fontPreset');
    if (stored) return stored;
    // Default to the platform font. The display presets (Shantell/Fredoka/…)
    // are still selectable in Settings — they're just no longer picked at random
    // for a brand-new install, which is what made the app read as a web page.
    localStorage.setItem('pollerama:fontPreset', SYSTEM_FONT_ID);
    return SYSTEM_FONT_ID;
  });
  const [colorPresetId, setColorPresetId] = useState(() => {
    // Only multi-color palettes exist now; retired single-color presets and the
    // old custom theme migrate to the closest palette (resolvePaletteId).
    const stored = localStorage.getItem(PALETTE_KEY);
    const resolved = resolvePaletteId(stored);
    if (resolved !== stored) localStorage.setItem(PALETTE_KEY, resolved);
    return resolved;
  });
  const [finish, setFinishState] = useState<BlockFinish>(() => {
    const stored = localStorage.getItem(FINISH_KEY);
    if ((BLOCK_FINISHES as readonly string[]).includes(stored ?? '')) return stored as BlockFinish;
    // No finish picked yet: start each user on a random one (kept from then on),
    // so the app looks different from install to install.
    const random = BLOCK_FINISHES[Math.floor(Math.random() * BLOCK_FINISHES.length)];
    localStorage.setItem(FINISH_KEY, random);
    return random;
  });

  useEffect(() => {
    document.body.style.fontFamily = getFontPreset(fontPresetId).fontFamily;
  }, [fontPresetId]);

  const setFontPreset = useCallback((id: string) => {
    localStorage.setItem('pollerama:fontPreset', id);
    setFontPresetId(id);
  }, []);

  const setColorPreset = useCallback((id: string) => {
    const resolved = resolvePaletteId(id);
    localStorage.setItem(PALETTE_KEY, resolved);
    setColorPresetId(resolved);
  }, []);

  const [customPalette, setCustomPaletteState] = useState<string[]>(readCustomPalette);
  const setCustomPalette = useCallback((colors: string[]) => {
    localStorage.setItem(CUSTOM_PALETTE_KEY, JSON.stringify(colors));
    localStorage.setItem(PALETTE_KEY, CUSTOM_PALETTE_ID);
    setCustomPaletteState(colors);
    setColorPresetId(CUSTOM_PALETTE_ID);
  }, []);

  const setFinish = useCallback((f: BlockFinish) => {
    localStorage.setItem(FINISH_KEY, f);
    setFinishState(f);
  }, []);

  const colorPreset = useMemo(
    () => (colorPresetId === CUSTOM_PALETTE_ID ? buildCustomPalette(customPalette) : getColorPreset(colorPresetId)),
    [colorPresetId, customPalette]
  );

  return (
    <AppearanceContext.Provider
      value={{
        fontPresetId,
        colorPresetId,
        colorPreset,
        setFontPreset,
        setColorPreset,
        customPalette,
        setCustomPalette,
        finish,
        setFinish,
      }}
    >
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance() {
  return useContext(AppearanceContext);
}
