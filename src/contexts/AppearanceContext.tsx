import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  FONT_PRESETS,
  COLOR_PRESETS,
  ColorPreset,
  getFontPreset,
  getColorPreset,
  buildCustomPreset,
  CUSTOM_PRESET_ID,
  DEFAULT_CUSTOM_PRIMARY,
  DEFAULT_CUSTOM_SECONDARY,
} from '../styles/themes';

interface CustomColors {
  primary: string;
  secondary: string;
}

interface AppearanceContextType {
  fontPresetId: string;
  colorPresetId: string;
  /** The resolved color preset for the current selection (handles "custom"). */
  colorPreset: ColorPreset;
  /** The user's saved custom colors (editable in the "make your own" section). */
  customColors: CustomColors;
  setFontPreset: (id: string) => void;
  setColorPreset: (id: string) => void;
  /** Save custom primary/secondary and switch to the custom theme. */
  setCustomColors: (colors: CustomColors) => void;
}

const AppearanceContext = createContext<AppearanceContextType>({
  fontPresetId: 'shantell',
  colorPresetId: 'golden',
  colorPreset: COLOR_PRESETS[0],
  customColors: { primary: DEFAULT_CUSTOM_PRIMARY, secondary: DEFAULT_CUSTOM_SECONDARY },
  setFontPreset: () => {},
  setColorPreset: () => {},
  setCustomColors: () => {},
});

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [fontPresetId, setFontPresetId] = useState(() => {
    const stored = localStorage.getItem('pollerama:fontPreset');
    if (stored) return stored;
    const random = FONT_PRESETS[Math.floor(Math.random() * FONT_PRESETS.length)].id;
    localStorage.setItem('pollerama:fontPreset', random);
    return random;
  });
  const [colorPresetId, setColorPresetId] = useState(() => {
    const stored = localStorage.getItem('pollerama:colorPreset');
    if (stored) return stored;
    const random = COLOR_PRESETS[Math.floor(Math.random() * COLOR_PRESETS.length)].id;
    localStorage.setItem('pollerama:colorPreset', random);
    return random;
  });
  const [customColors, setCustomColorsState] = useState<CustomColors>(() => ({
    primary: localStorage.getItem('pollerama:customPrimary') || DEFAULT_CUSTOM_PRIMARY,
    secondary: localStorage.getItem('pollerama:customSecondary') || DEFAULT_CUSTOM_SECONDARY,
  }));

  useEffect(() => {
    document.body.style.fontFamily = getFontPreset(fontPresetId).fontFamily;
  }, [fontPresetId]);

  const setFontPreset = useCallback((id: string) => {
    localStorage.setItem('pollerama:fontPreset', id);
    setFontPresetId(id);
  }, []);

  const setColorPreset = useCallback((id: string) => {
    localStorage.setItem('pollerama:colorPreset', id);
    setColorPresetId(id);
  }, []);

  // Persist the custom colors and select the custom theme so the change is visible.
  const setCustomColors = useCallback((colors: CustomColors) => {
    localStorage.setItem('pollerama:customPrimary', colors.primary);
    localStorage.setItem('pollerama:customSecondary', colors.secondary);
    localStorage.setItem('pollerama:colorPreset', CUSTOM_PRESET_ID);
    setCustomColorsState(colors);
    setColorPresetId(CUSTOM_PRESET_ID);
  }, []);

  const colorPreset = useMemo(
    () =>
      colorPresetId === CUSTOM_PRESET_ID
        ? buildCustomPreset(customColors.primary, customColors.secondary)
        : getColorPreset(colorPresetId),
    [colorPresetId, customColors]
  );

  return (
    <AppearanceContext.Provider
      value={{
        fontPresetId,
        colorPresetId,
        colorPreset,
        customColors,
        setFontPreset,
        setColorPreset,
        setCustomColors,
      }}
    >
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance() {
  return useContext(AppearanceContext);
}
