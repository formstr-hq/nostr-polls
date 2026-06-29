import React from 'react';
import { Box, ButtonBase, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CheckIcon from '@mui/icons-material/Check';
import { FONT_PRESETS, COLOR_PRESETS, CUSTOM_PRESET_ID } from '../../styles/themes';
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
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.08em' }}>
          Color Mode
        </Typography>
        <ColorSchemeToggle />
      </Box>

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.08em' }}>
          Accent Color
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          {COLOR_PRESETS.map((preset) => {
            const selected = colorPresetId === preset.id;
            const swatchColor = isDark ? preset.darkPrimary : preset.lightPrimary;
            const accentColor = isDark ? preset.darkSecondary : preset.lightSecondary;
            return (
              <ButtonBase
                key={preset.id}
                onClick={() => setColorPreset(preset.id)}
                title={preset.name}
                sx={{
                  borderRadius: '50%',
                  p: '3px',
                  border: '2px solid',
                  borderColor: selected ? 'text.primary' : 'transparent',
                  transition: 'border-color 0.15s',
                }}
              >
                <Box
                  sx={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    bgcolor: swatchColor,
                    ...(accentColor && {
                      background: `linear-gradient(135deg, ${swatchColor} 0%, ${swatchColor} 50%, ${accentColor} 50%, ${accentColor} 100%)`,
                    }),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {selected && (
                    <CheckIcon
                      sx={{
                        fontSize: 18,
                        color: theme.palette.getContrastText(swatchColor),
                      }}
                    />
                  )}
                </Box>
              </ButtonBase>
            );
          })}

          {/* The user's custom theme, selectable alongside the presets. */}
          <ButtonBase
            onClick={() => setColorPreset(CUSTOM_PRESET_ID)}
            title="Custom"
            sx={{
              borderRadius: '50%',
              p: '3px',
              border: '2px solid',
              borderColor: customSelected ? 'text.primary' : 'transparent',
              transition: 'border-color 0.15s',
            }}
          >
            <Box
              sx={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: `linear-gradient(135deg, ${customSwatch} 0%, ${customSwatch} 50%, ${customAccent} 50%, ${customAccent} 100%)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {customSelected && (
                <CheckIcon
                  sx={{ fontSize: 18, color: theme.palette.getContrastText(customSwatch) }}
                />
              )}
            </Box>
          </ButtonBase>

          <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
            {customSelected ? 'Custom' : COLOR_PRESETS.find(c => c.id === colorPresetId)?.name}
          </Typography>
        </Box>
      </Box>

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.08em' }}>
          Make Your Own
        </Typography>
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
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.08em' }}>
          Font
        </Typography>
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
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: selected ? 'primary.main' : 'divider',
                  bgcolor: selected ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
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
                      color: selected ? 'primary.main' : 'text.primary',
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
                      bgcolor: 'primary.main',
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
