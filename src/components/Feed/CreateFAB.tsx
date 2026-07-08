import React, { useState } from "react";
import { Badge, SpeedDial, SpeedDialAction, SpeedDialIcon } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import RefreshIcon from "@mui/icons-material/Refresh";
import FiberNewIcon from "@mui/icons-material/FiberNew";
import DescriptionIcon from "@mui/icons-material/Description";
import { useNavigate, useLocation } from "react-router-dom";
import { useFeedActions } from "../../contexts/FeedActionsContext";
import { useNotification } from "../../contexts/notification-context";
import { DraggableCorner } from "../Common/DraggableCorner";
import { useDrafts } from "../../contexts/drafts-context";

interface CreateFABProps {
  extraActions?: {
    icon: React.ReactNode;
    name: string;
    onClick: () => void;
  }[];
}

const CreateFAB: React.FC<CreateFABProps> = ({ extraActions = [] }) => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { isScrolledDown, scrollToTop, refresh, newItemCount, newItemLabel, showNewItems } =
    useFeedActions();
  const { showNotification } = useNotification();
  const { drafts } = useDrafts();
  const draftCount = drafts?.size ?? 0;

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

  const handleOpenDrafts = () => {
    setOpen(false);
    navigate("/drafts");
  };

  const handleScrollToTop = () => {
    setOpen(false);
    scrollToTop();
  };

  const handleRefresh = () => {
    setOpen(false);
    refresh();
  };

  const handleShowNew = () => {
    setOpen(false);
    showNewItems();
    showNotification(
      `Added ${newItemCount} new ${newItemLabel} to the feed`,
      "success",
      2500,
    );
  };


  const actionSx = {
    border: (theme: any) => `2px solid ${theme.palette.secondary.main}`,
  };

  const hasNewItems = newItemCount > 0;

  return (
    <DraggableCorner
      storageKey="pollerama:createFabCorner"
      defaultCorner="br"
      offset={{ x: 24, y: 24 }}
      zIndex={1000}
      disableIdle={hasNewItems}
      handle=".MuiSpeedDial-fab"
    >
      {(corner) => (
        <SpeedDial
          ariaLabel="Feed actions"
          direction={corner.startsWith("t") ? "down" : "up"}
          // The app's primary floating action carries the secondary accent — the
          // most visible place the theme's secondary color shows up.
          FabProps={{ color: "secondary" }}
          sx={{
            "& .MuiSpeedDial-fab": {
              position: "relative",
              border: (theme: any) => `2px solid ${theme.palette.secondary.main}`,
            },
            // Notification dot anchored to the FAB itself (not the dial root,
            // whose actions area would push it off the button).
            ...(hasNewItems && !open
              ? {
                  "& .MuiSpeedDial-fab::after": {
                    content: '""',
                    position: "absolute",
                    top: "-3px",
                    right: "-3px",
                    width: "13px",
                    height: "13px",
                    borderRadius: "50%",
                    backgroundColor: "error.main",
                    border: "2px solid",
                    borderColor: "background.paper",
                    pointerEvents: "none",
                  },
                }
              : {}),
          }}
          icon={<SpeedDialIcon icon={<AddIcon />} />}
          open={open}
          onOpen={() => setOpen(true)}
          onClose={() => setOpen(false)}
        >
          {newItemCount > 0 && (
            <SpeedDialAction
              icon={
                <Badge badgeContent={newItemCount} color="error" max={99}>
                  <FiberNewIcon />
                </Badge>
              }
              tooltipTitle={`Show ${newItemCount} new ${newItemLabel}`}
              onClick={handleShowNew}
              sx={actionSx}
            />
          )}
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
          <SpeedDialAction
            icon={
              <Badge badgeContent={draftCount} color="primary" invisible={draftCount === 0} max={99}>
                <DescriptionIcon />
              </Badge>
            }
            tooltipTitle={draftCount > 0 ? `Drafts (${draftCount})` : "Drafts"}
            onClick={handleOpenDrafts}
            sx={actionSx}
          />
          {extraActions.map((action, index) => (
            <SpeedDialAction
              key={`extra-action-${index}`}
              icon={action.icon}
              tooltipTitle={action.name}
              onClick={() => {
                setOpen(false);
                action.onClick();
              }}
              sx={actionSx}
            />
          ))}
          <SpeedDialAction
            icon={<AddIcon />}
            tooltipTitle="Create"
            onClick={handleCreate}
            sx={actionSx}
          />
        </SpeedDial>
      )}
    </DraggableCorner>
  );
};

export default CreateFAB;
