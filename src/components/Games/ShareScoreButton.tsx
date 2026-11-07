import React, { useState } from "react";
import { Button, Menu, MenuItem } from "@mui/material";
import ShareIcon from "@mui/icons-material/Share";
import { useUserContext } from "../../hooks/useUserContext";
import { useNotification } from "../../contexts/notification-context";
import { copyToClipboard } from "../../utils/common";
import { buildScoreShareText, publishScoreNote } from "../../games/core/shareScore";

interface ShareScoreButtonProps {
  gameLabel: string;
  gameId: string;
  score: number;
  dateIso: string;
  /** Optional custom share text (e.g. streaks don't read well as "I scored N"). */
  shareText?: string;
}

const ShareScoreButton: React.FC<ShareScoreButtonProps> = ({
  gameLabel,
  gameId,
  score,
  dateIso,
  shareText,
}) => {
  const { user } = useUserContext();
  const { showNotification } = useNotification();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const text = shareText ?? buildScoreShareText(gameLabel, gameId, score, dateIso);

  const handlePost = async () => {
    setAnchorEl(null);
    try {
      await publishScoreNote(text, user?.privateKey);
      showNotification("Posted to Nostr!", "success");
    } catch (err) {
      console.error("Failed to publish score note", err);
      showNotification("Failed to post note", "error");
    }
  };

  const handleCopy = async () => {
    setAnchorEl(null);
    await copyToClipboard(text);
    showNotification("Copied to clipboard!", "success");
  };

  return (
    <>
      <Button variant="outlined" startIcon={<ShareIcon />} onClick={(e) => setAnchorEl(e.currentTarget)}>
        Share
      </Button>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
        <MenuItem onClick={handlePost}>Post as Nostr note</MenuItem>
        <MenuItem onClick={handleCopy}>Copy text</MenuItem>
      </Menu>
    </>
  );
};

export default ShareScoreButton;
