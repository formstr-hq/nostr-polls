import React, { useRef, useState } from "react";
import {
  ClickAwayListener,
  IconButton,
  Paper,
  Popper,
  Tooltip,
  useTheme,
} from "@mui/material";
import SentimentSatisfiedAltIcon from "@mui/icons-material/SentimentSatisfiedAlt";
import EmojiPicker, { Theme } from "emoji-picker-react";

interface EmojiPickerButtonProps {
  onSelect: (emoji: string) => void;
  disabled?: boolean;
  size?: "small" | "medium" | "large";
  tooltip?: string;
  /** Optional sx applied to the IconButton (e.g. for the bordered look in the note creator toolbar) */
  iconButtonSx?: React.ComponentProps<typeof IconButton>["sx"];
  /** Popper placement — default "top-start" puts the picker above the trigger */
  placement?: React.ComponentProps<typeof Popper>["placement"];
}

const EmojiPickerButton: React.FC<EmojiPickerButtonProps> = ({
  onSelect,
  disabled,
  size = "small",
  tooltip = "Insert emoji",
  iconButtonSx,
  placement = "top-start",
}) => {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const theme = useTheme();

  const handleEmojiClick = (emojiData: { emoji: string }) => {
    onSelect(emojiData.emoji);
    setOpen(false);
  };

  return (
    <>
      <Tooltip title={tooltip}>
        <span>
          <IconButton
            ref={anchorRef}
            size={size}
            disabled={disabled}
            onClick={() => setOpen((v) => !v)}
            sx={iconButtonSx}
          >
            <SentimentSatisfiedAltIcon fontSize={size === "small" ? "small" : "medium"} />
          </IconButton>
        </span>
      </Tooltip>

      <Popper
        open={open}
        anchorEl={anchorRef.current}
        placement={placement}
        style={{ zIndex: 1301 }}
        modifiers={[{ name: "offset", options: { offset: [0, 8] } }]}
      >
        <ClickAwayListener onClickAway={() => setOpen(false)}>
          <Paper
            elevation={8}
            sx={{ overflow: "hidden", borderRadius: 2 }}
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            <EmojiPicker
              theme={
                theme.palette.mode === "light"
                  ? ("light" as Theme)
                  : ("dark" as Theme)
              }
              onEmojiClick={handleEmojiClick}
            />
          </Paper>
        </ClickAwayListener>
      </Popper>
    </>
  );
};

export default EmojiPickerButton;
