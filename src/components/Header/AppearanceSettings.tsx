import React from 'react';
import { Box, ButtonBase, Typography, useTheme } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { FONT_PRESETS, COLOR_PRESETS, PALETTE_PRESETS, CUSTOM_PRESET_ID } from '../../styles/themes';
import { useAppearance } from '../../contexts/AppearanceContext';
import { ColorSchemeToggle } from '../ColorScheme';

// A circular swatch backed by a native <input type="color">, so picking a color
// uses the OS picker (reliable on web + Android WebView). The visible circle shows
// the current value; the input sits invisibly on top to catch the tap.
const ColorPicker: React.FC<{
  label: string;
  value: string;
  onChange: (color: string) => void;
}> = ({ label, value, onChange }) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75 }}>
    <Box
      sx={{
        position: 'relative',
        width: 40,
        height: 40,
        borderRadius: '50%',
        bgcolor: value,
        border: '2px solid',
        borderColor: 'divider',
        cursor: 'pointer',
        overflow: 'hidden',
      }}
    >
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: 0,
          border: 'none',
          padding: 0,
          cursor: 'pointer',
        }}
      />
    </Box>
    <Typography variant="caption" color="text.secondary">
      {label}
    </Typography>
  </Box>
);

const GRID_SX = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))',
  gap: 1,
} as const;

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography
    variant="subtitle2"
    sx={{ mb: 1.5, fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.72rem', letterSpacing: '0.08em' }}
  >
    {children}
  </Typography>
);

// A theme tile: a mini "block" showing the theme's colors (one stripe per color).
const ThemeTile: React.FC<{
  name: string;
  colors: string[];
  selected: boolean;
  onClick: () => void;
}> = ({ name, colors, selected, onClick }) => (
  <ButtonBase
    onClick={onClick}
    aria-pressed={selected}
    title={name}
    sx={{
      position: 'relative',
      flexDirection: 'column',
      gap: 0.75,
      p: 1,
      borderRadius: '18px',
      bgcolor: 'cb.inner',
      fontFamily: 'inherit',
      fontSize: 12,
      fontWeight: 700,
      color: 'text.primary',
      boxShadow: (t) => (selected ? `inset 0 0 0 2.5px ${t.palette.text.primary}` : 'none'),
    }}
  >
    <Box sx={{ width: '100%', height: 44, borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {colors.map((c, i) => (
        <Box key={i} sx={{ flex: 1, bgcolor: c }} />
      ))}
    </Box>
    {name}
    {selected && (
      <Box
        sx={{
          position: 'absolute',
          top: 4,
          right: 4,
          width: 20,
          height: 20,
          borderRadius: '50%',
          bgcolor: 'text.primary',
          color: 'background.paper',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CheckIcon sx={{ fontSize: 14 }} />
      </Box>
    )}
  </ButtonBase>
);

export const AppearanceSettings: React.FC = () => {
  const {
    fontPresetId,
    colorPresetId,
    customColors,
    setFontPreset,
    setColorPreset,
    setCustomColors,
  } = useAppearance();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  // The custom theme shows the same colors in both modes (see buildCustomPreset).
  const customSwatch = customColors.primary;
  const customAccent = customColors.secondary;
  const customSelected = colorPresetId === CUSTOM_PRESET_ID;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <SectionLabel>Color Mode</SectionLabel>
        <ColorSchemeToggle />
      </Box>

      <Box>
        <SectionLabel>Single color</SectionLabel>
        <Box sx={GRID_SX}>
          {COLOR_PRESETS.map((preset) => (
            <ThemeTile
              key={preset.id}
              name={preset.name}
              colors={[isDark ? preset.darkPrimary : preset.lightPrimary]}
              selected={colorPresetId === preset.id}
              onClick={() => setColorPreset(preset.id)}
            />
          ))}
          {/* The user's custom theme, selectable alongside the presets. */}
          <ThemeTile
            name="Custom"
            colors={[customSwatch, customAccent]}
            selected={customSelected}
            onClick={() => setColorPreset(CUSTOM_PRESET_ID)}
          />
        </Box>
      </Box>

      <Box>
        <SectionLabel>Palettes</SectionLabel>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -1, mb: 1.5 }}>
          Three colors: one for notes, one for polls, one for highlights.
        </Typography>
        <Box sx={GRID_SX}>
          {PALETTE_PRESETS.map((preset) => (
            <ThemeTile
              key={preset.id}
              name={preset.name}
              colors={preset.palette ? (isDark ? preset.palette.dark : preset.palette.light) : [preset.lightPrimary]}
              selected={colorPresetId === preset.id}
              onClick={() => setColorPreset(preset.id)}
            />
          ))}
        </Box>
      </Box>

      <Box>
        <SectionLabel>Make Your Own</SectionLabel>
        <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
          <ColorPicker
            label="Primary"
            value={customColors.primary}
            onChange={(c) => setCustomColors({ ...customColors, primary: c })}
          />
          <ColorPicker
            label="Secondary"
            value={customColors.secondary}
            onChange={(c) => setCustomColors({ ...customColors, secondary: c })}
          />
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1, mt: 0.5 }}>
            Pick a primary and secondary color to build your own theme. Choosing a color
            selects it automatically.
          </Typography>
        </Box>
      </Box>

      <Box>
        <SectionLabel>Font</SectionLabel>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {FONT_PRESETS.map((preset) => {
            const selected = fontPresetId === preset.id;
            return (
              <ButtonBase
                key={preset.id}
                onClick={() => setFontPreset(preset.id)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  px: 2,
                  py: 1.25,
                  borderRadius: '16px',
                  border: 'none',
                  bgcolor: 'cb.inner',
                  boxShadow: selected ? `inset 0 0 0 2.5px ${theme.palette.text.primary}` : 'none',
                  width: '100%',
                  transition: 'all 0.15s',
                  textAlign: 'left',
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontFamily: preset.fontFamily,
                      fontSize: '1rem',
                      fontWeight: selected ? 600 : 400,
                      color: 'text.primary',
                      lineHeight: 1.3,
                    }}
                  >
                    {preset.name}
                  </Typography>
                  <Typography
                    sx={{
                      fontFamily: preset.fontFamily,
                      fontSize: '0.75rem',
                      color: 'text.secondary',
                      lineHeight: 1.4,
                    }}
                  >
                    The quick brown fox jumps over the lazy dog
                  </Typography>
                </Box>
                {selected && (
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      bgcolor: 'text.primary',
                      flexShrink: 0,
                      ml: 1,
                    }}
                  />
                )}
              </ButtonBase>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
};
