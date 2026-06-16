import React from 'react';
import { Box, ButtonBase, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CheckIcon from '@mui/icons-material/Check';
import { FONT_PRESETS, COLOR_PRESETS } from '../../styles/themes';
import { useAppearance } from '../../contexts/AppearanceContext';
import { ColorSchemeToggle } from '../ColorScheme';

export const AppearanceSettings: React.FC = () => {
  const { fontPresetId, colorPresetId, setFontPreset, setColorPreset } = useAppearance();
  const theme = useTheme();

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
            const swatchColor =
              theme.palette.mode === 'dark' ? preset.darkPrimary : preset.lightPrimary;
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
          <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
            {COLOR_PRESETS.find(c => c.id === colorPresetId)?.name}
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
