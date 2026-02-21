import React from "react";
import {
  Box,
  Drawer,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import AddReactionOutlinedIcon from "@mui/icons-material/AddReactionOutlined";
import ReplyIcon from "@mui/icons-material/Reply";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { DMMessage } from "../../contexts/dm-context";

const QUICK_EMOJIS = [
  "\u{1F44D}",
  "\u{2764}\u{FE0F}",
  "\u{1F602}",
  "\u{1F622}",
  "\u{1F525}",
];

interface MessageContextMenuProps {
  msg: DMMessage | null;
  onClose: () => void;
  onReact: (emoji: string, msgId: string) => void;
  onReply: (msg: DMMessage) => void;
  onCopy: (content: string) => void;
  onOpenEmojiPicker: (msgId: string) => void;
}

const MessageContextMenu: React.FC<MessageContextMenuProps> = ({
  msg,
  onClose,
  onReact,
  onReply,
  onCopy,
  onOpenEmojiPicker,
}) => {
  return (
    <Drawer
      anchor="bottom"
      open={Boolean(msg)}
      onClose={onClose}
      PaperProps={{
        sx: { borderRadius: "16px 16px 0 0", pb: 2 },
      }}
    >
      {msg && (
        <Box>
          {/* Drag handle */}
          <Box display="flex" justifyContent="center" pt={1.5} pb={0.5}>
            <Box
              sx={{ width: 36, height: 4, bgcolor: "divider", borderRadius: 2 }}
            />
          </Box>

          {/* Quick emoji strip */}
          <Box display="flex" justifyContent="center" gap={0.5} px={2} py={1}>
            {QUICK_EMOJIS.map((emoji) => (
              <IconButton
                key={emoji}
                onClick={() => {
                  onReact(emoji, msg.id);
                  onClose();
                }}
              >
                <span style={{ fontSize: 28 }}>{emoji}</span>
              </IconButton>
            ))}
            <IconButton
              onClick={() => {
                onOpenEmojiPicker(msg.id);
                onClose();
              }}
            >
              <AddReactionOutlinedIcon />
            </IconButton>
          </Box>

          <Divider />

          <List disablePadding>
            <ListItemButton
              onClick={() => {
                onReply(msg);
                onClose();
              }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <ReplyIcon />
              </ListItemIcon>
              <ListItemText primary="Reply" />
            </ListItemButton>
            <ListItemButton
              onClick={() => {
                onCopy(msg.content);
                onClose();
              }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <ContentCopyIcon />
              </ListItemIcon>
              <ListItemText primary="Copy" />
            </ListItemButton>
          </List>
        </Box>
      )}
    </Drawer>
  );
};

export default MessageContextMenu;
