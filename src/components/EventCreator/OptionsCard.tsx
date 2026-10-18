import React, { useEffect, useRef } from 'react';
import { Box, ButtonBase, CircularProgress, IconButton, InputBase, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/AddRounded';
import CloseIcon from '@mui/icons-material/CloseRounded';
import AddPhotoIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import ErrorIcon from '@mui/icons-material/ErrorOutlineRounded';
import { Option } from "../../interfaces"

interface OptionsCardProps {
  onAddOption: () => void;
  onRemoveOption: (index: number) => void;
  onEditOptions: (newOptions: Option[]) => void;
  options: Option[];
  onPasteFile?: (file: File, index: number, cursorPos: number) => void;
  onClickAttach?: (index: number) => void;
  uploadingIndex?: number | null;
}

/** Index of an earlier option with the same label (case/space-insensitive), or -1. */
export const duplicateOf = (options: Option[], index: number) => {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const mine = norm(options[index][1]);
  if (!mine) return -1;
  return options.findIndex((o, i) => i < index && norm(o[1]) === mine);
};

// Color Block poll options: each option is an inner slab with its number. Enter
// in the last option adds another; Backspace in an empty option removes it.
const OptionsCard: React.FC<OptionsCardProps> = ({
  onAddOption,
  onRemoveOption,
  onEditOptions,
  options,
  onPasteFile,
  onClickAttach,
  uploadingIndex,
}) => {
  const inputs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const focusIndex = useRef<number | null>(null);

  // Focus the option that keyboard handling asked for once it exists.
  useEffect(() => {
    if (focusIndex.current !== null) {
      inputs.current[focusIndex.current]?.focus();
      focusIndex.current = null;
    }
  }, [options.length]);

  const handleEditOption = (index: number, value: string) => {
    const newOptions = [...options];
    newOptions[index] = [newOptions[index][0], value];
    onEditOptions(newOptions);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {options.map((option, index) => {
        const dup = duplicateOf(options, index);
        return (
          <Box key={option[0]}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                minHeight: 54,
                pl: 1,
                pr: 0.5,
                borderRadius: '16px',
                bgcolor: 'cb.inner',
                boxShadow: (t) => (dup >= 0 ? `inset 0 0 0 2px ${t.palette.error.main}` : 'none'),
                '&:focus-within': {
                  boxShadow: (t) => `inset 0 0 0 2px ${dup >= 0 ? t.palette.error.main : t.palette.text.primary}`,
                },
              }}
            >
              <Box
                sx={{
                  width: 26,
                  height: 26,
                  flex: 'none',
                  borderRadius: '9px',
                  bgcolor: 'cb.poll',
                  color: 'cb.onPoll',
                  fontSize: 12.5,
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {index + 1}
              </Box>
              <InputBase
                inputRef={(el) => (inputs.current[index] = el)}
                multiline
                fullWidth
                placeholder={`Option ${index + 1}`}
                inputProps={{ 'aria-label': `Option ${index + 1}` }}
                value={option[1]}
                onChange={(e) => handleEditOption(index, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (index === options.length - 1) {
                      focusIndex.current = index + 1;
                      onAddOption();
                    } else {
                      inputs.current[index + 1]?.focus();
                    }
                  } else if (e.key === 'Backspace' && option[1] === '' && options.length > 1) {
                    e.preventDefault();
                    onRemoveOption(index);
                    requestAnimationFrame(() => inputs.current[Math.max(0, index - 1)]?.focus());
                  }
                }}
                onPaste={(e) => {
                  if (!onPasteFile) return;
                  const file = Array.from(e.clipboardData.files).find(
                    (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
                  );
                  if (file) {
                    e.preventDefault();
                    const cursorPos = (e.target as HTMLTextAreaElement).selectionStart ?? option[1].length;
                    onPasteFile(file, index, cursorPos);
                  }
                }}
                sx={{ px: 0.75, py: 1, fontSize: 16, fontWeight: 600 }}
              />
              {onClickAttach && (
                <Tooltip title="Attach image or video (Blossom)">
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => onClickAttach(index)}
                      disabled={uploadingIndex === index}
                      aria-label={`Attach media to option ${index + 1}`}
                      sx={{ color: 'text.secondary' }}
                    >
                      {uploadingIndex === index ? <CircularProgress size={18} /> : <AddPhotoIcon fontSize="small" />}
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              <IconButton
                size="small"
                onClick={() => onRemoveOption(index)}
                aria-label={`Remove option ${index + 1}`}
                sx={{ color: 'text.secondary' }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
            {dup >= 0 && (
              <Typography variant="caption" color="error" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 1.5, pt: 0.5 }}>
                <ErrorIcon sx={{ fontSize: 15 }} /> Same as option {dup + 1}
              </Typography>
            )}
          </Box>
        );
      })}
      <ButtonBase
        onClick={onAddOption}
        sx={{
          height: 50,
          borderRadius: '16px',
          border: '2px dashed',
          borderColor: 'divider',
          gap: 1,
          fontFamily: 'inherit',
          fontWeight: 700,
          fontSize: 15,
          color: 'text.primary',
        }}
      >
        <AddIcon /> Add option
      </ButtonBase>
    </Box>
  );
};

export default OptionsCard;
