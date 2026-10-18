import React from 'react';
import { Box, ButtonBase, Typography, useTheme } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { FONT_PRESETS, PALETTE_PRESETS, CUSTOM_PALETTE_ID, PALETTE_SLOT_LABELS, buildCustomPalette } from '../../styles/themes';
import { useAppearance } from '../../contexts/AppearanceContext';
import { BLOCK_FINISHES, BlockFinish, blockFill } from '../../styles/theme';

import { ColorSchemeToggle } from '../ColorScheme';

const FINISH_LABELS: Record<BlockFinish, string> = {
  solid: 'Solid',
  gradient: 'Gradient',
  aurora: 'Aurora',
  holographic: 'Holo',
  metallic: 'Metallic',
  glossy: 'Glossy',
};

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
    <Box sx={{ width: '100%', height: 48, borderRadius: '12px', overflow: 'hidden', display: 'flex' }}>
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

// One palette slot: a big swatch backed by a native <input type="color"> (the
// OS picker is reliable on web and in the Android WebView) with its label.
const SlotPicker: React.FC<{ label: string; value: string; onChange: (c: string) => void }> = ({
  label,
  value,
  onChange,
}) => (
  <Box
    component="label"
    sx={{
      display: 'flex',
      flexDirection: 'column',
      gap: 0.75,
      p: 1,
      borderRadius: '18px',
      bgcolor: 'cb.inner',
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 700,
      textAlign: 'center',
      lineHeight: 1.25,
    }}
  >
    <Box sx={{ position: 'relative', height: 44, borderRadius: '12px', bgcolor: value, overflow: 'hidden' }}>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label} color`}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, border: 'none', padding: 0, cursor: 'pointer' }}
      />
    </Box>
    {label}
  </Box>
);

export const AppearanceSettings: React.FC = () => {
  const {
    fontPresetId,
    colorPresetId,
    setFontPreset,
    setColorPreset,
    customPalette,
    setCustomPalette,
    finish,
    setFinish,
  } = useAppearance();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <SectionLabel>Color Mode</SectionLabel>
        <ColorSchemeToggle />
      </Box>

      <Box>
        <SectionLabel>Palette</SectionLabel>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -1, mb: 1.5 }}>
          Every part of the app gets its own color from your palette.
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1 }}>
          {PALETTE_PRESETS.map((preset) => (
            <ThemeTile
              key={preset.id}
              name={preset.name}
              colors={preset.palette ? (isDark ? preset.palette.dark : preset.palette.light) : [preset.lightPrimary]}
              selected={colorPresetId === preset.id}
              onClick={() => setColorPreset(preset.id)}
            />
          ))}
          {/* The user's own palette, built below. */}
          <ThemeTile
            name="Mine"
            colors={(() => {
              const mine = buildCustomPalette(customPalette).palette!;
              return isDark ? mine.dark : mine.light;
            })()}
            selected={colorPresetId === CUSTOM_PALETTE_ID}
            onClick={() => setColorPreset(CUSTOM_PALETTE_ID)}
          />
        </Box>
      </Box>

      <Box>
        <SectionLabel>Make your own palette</SectionLabel>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -1, mb: 1.5 }}>
          Pick a color for each part of the app. Changes apply instantly and select your palette.
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
          {PALETTE_SLOT_LABELS.map((label, i) => (
            <SlotPicker
              key={label}
              label={label}
              value={customPalette[i]}
              onChange={(c) => {
                const next = [...customPalette];
                next[i] = c;
                setCustomPalette(next);
              }}
            />
          ))}
        </Box>
      </Box>

      <Box>
        <SectionLabel>Finish</SectionLabel>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -1, mb: 1.5 }}>
          How the color blocks are painted.
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
          {BLOCK_FINISHES.map((f) => {
            const selected = finish === f;
            return (
              <ButtonBase
                key={f}
                onClick={() => setFinish(f)}
                aria-pressed={selected}
                sx={{
                  position: 'relative',
                  flexDirection: 'column',
                  gap: 0.75,
                  p: 1,
                  borderRadius: '18px',
                  bgcolor: 'cb.inner',
                  fontFamily: 'inherit',
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: 'text.primary',
                  boxShadow: (t) => (selected ? `inset 0 0 0 2.5px ${t.palette.text.primary}` : 'none'),
                }}
              >
                <Box sx={{ width: '100%', height: 52, borderRadius: '14px', background: blockFill(theme.palette.cb.sections, 0, f) }} />
                {FINISH_LABELS[f]}
              </ButtonBase>
            );
          })}
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
