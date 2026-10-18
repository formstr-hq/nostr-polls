import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  COLOR_PRESETS,
  ColorPreset,
  getFontPreset,
  getColorPreset,
  buildCustomPreset,
  CUSTOM_PRESET_ID,
  DEFAULT_CUSTOM_PRIMARY,
  DEFAULT_CUSTOM_SECONDARY,
  SYSTEM_FONT_ID,
  DEFAULT_COLOR_PRESET_ID,
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
    // Default to the platform font. The display presets (Shantell/Fredoka/…)
    // are still selectable in Settings — they're just no longer picked at random
    // for a brand-new install, which is what made the app read as a web page.
    localStorage.setItem('pollerama:fontPreset', SYSTEM_FONT_ID);
    return SYSTEM_FONT_ID;
  });
  const [colorPresetId, setColorPresetId] = useState(() => {
    const stored = localStorage.getItem('pollerama:colorPreset');
    if (stored) return stored;
    // New installs start on a multi-color palette (Color Block). Existing users
    // keep whatever they picked.
    localStorage.setItem('pollerama:colorPreset', DEFAULT_COLOR_PRESET_ID);
    return DEFAULT_COLOR_PRESET_ID;
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
