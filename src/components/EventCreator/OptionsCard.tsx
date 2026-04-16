import React from 'react';
import { Card, CardContent, TextField, Button, CardActions, IconButton, Tooltip, CircularProgress } from '@mui/material';
import { Add, Delete } from '@mui/icons-material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
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

const OptionsCard: React.FC<OptionsCardProps> = ({
  onAddOption,
  onRemoveOption,
  onEditOptions,
  options,
  onPasteFile,
  onClickAttach,
  uploadingIndex,
}) => {
  const handleEditOption = (index: number, value: string) => {
    const newOptions = [...options];
    newOptions[index][1] = value;
    onEditOptions(newOptions);
  };

  return (
    <Card variant="outlined">
      {options.length > 0 && (
        <CardContent sx={{ pb: 0 }}>
          {options.map((option, index) => (
            <div key={index} style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <TextField
                label={`Option ${index + 1}`}
                fullWidth
                multiline
                value={option[1]}
                onChange={(e) => handleEditOption(index, e.target.value)}
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
                sx={{ mr: 1 }}
              />
              {onClickAttach && (
                <Tooltip title="Attach image or video (Blossom)">
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => onClickAttach(index)}
                      disabled={uploadingIndex === index}
                      sx={{
                        mr: 0.5,
                        border: "1px solid",
                        borderColor: "primary.main",
                        borderRadius: "50%",
                        color: "primary.main",
                      }}
                    >
                      {uploadingIndex === index ? (
                        <CircularProgress size={18} />
                      ) : (
                        <AttachFileIcon fontSize="small" />
                      )}
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              <IconButton
                color="error"
                onClick={() => onRemoveOption(index)}
                disabled={options.length <= 2}
              >
                <Delete />
              </IconButton>
            </div>
          ))}
        </CardContent>
      )}
      <CardActions sx={{ pt: 2, pb: 2 }}>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={onAddOption}
        >
          Add Option
        </Button>
      </CardActions>
    </Card>
  );
};

export default OptionsCard;
