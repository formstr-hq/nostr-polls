import React, { useState } from "react";
import { SpeedDial, SpeedDialAction, SpeedDialIcon } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import RefreshIcon from "@mui/icons-material/Refresh";
import EditNoteIcon from "@mui/icons-material/EditNote";
import PollIcon from "@mui/icons-material/Poll";
import { useNavigate, useLocation } from "react-router-dom";
import { useFeedActions } from "../../contexts/FeedActionsContext";

const CreateFAB: React.FC = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { isScrolledDown, scrollToTop, refresh } = useFeedActions();
  const isAllFeed = location.pathname.startsWith("/feeds/all");

  const handleCreate = () => {
    setOpen(false);
    if (location.pathname.startsWith("/feeds/polls")) {
      navigate("/create?type=poll");
    } else {
      const match = location.pathname.match(/\/feeds\/topics\/(.+)/);
      if (match) {
        navigate(`/create?hashtag=${encodeURIComponent(match[1])}`);
      } else {
        navigate("/create");
      }
    }
  };

  const handleCreateNote = () => {
    setOpen(false);
    navigate("/create");
  };

  const handleCreatePoll = () => {
    setOpen(false);
    navigate("/create?type=poll");
  };

  const handleScrollToTop = () => {
    setOpen(false);
    scrollToTop();
  };

  const handleRefresh = () => {
    setOpen(false);
    refresh();
  };


  const actionSx = {
    border: (theme: any) => `2px solid ${theme.palette.primary.main}`,
  };

  return (
    <SpeedDial
      ariaLabel="Feed actions"
      sx={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 1000,
        "& .MuiFab-primary": {
          border: (theme: any) => `2px solid ${theme.palette.primary.main}`,
        },
      }}
      icon={<SpeedDialIcon icon={<AddIcon />} />}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
    >
      {isScrolledDown && (
        <SpeedDialAction
          icon={<KeyboardArrowUpIcon />}
          tooltipTitle="Back to top"
          onClick={handleScrollToTop}
          sx={actionSx}
        />
      )}
      <SpeedDialAction
        icon={<RefreshIcon />}
        tooltipTitle="Refresh"
        onClick={handleRefresh}
        sx={actionSx}
      />
      {isAllFeed ? (
        <>
          <SpeedDialAction
            icon={<EditNoteIcon />}
            tooltipTitle="Create note"
            onClick={handleCreateNote}
            sx={actionSx}
          />
          <SpeedDialAction
            icon={<PollIcon />}
            tooltipTitle="Create poll"
            onClick={handleCreatePoll}
            sx={actionSx}
          />
        </>
      ) : (
        <SpeedDialAction
          icon={<AddIcon />}
          tooltipTitle="Create"
          onClick={handleCreate}
          sx={actionSx}
        />
      )}
    </SpeedDial>
  );
};

export default CreateFAB;
