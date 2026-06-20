import React, { useState } from "react";
import { Badge, SpeedDial, SpeedDialAction, SpeedDialIcon } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import RefreshIcon from "@mui/icons-material/Refresh";
import FiberNewIcon from "@mui/icons-material/FiberNew";
import { useNavigate, useLocation } from "react-router-dom";
import { useFeedActions } from "../../contexts/FeedActionsContext";
import { useNotification } from "../../contexts/notification-context";
import { DraggableCorner } from "../Common/DraggableCorner";

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
    border: (theme: any) => `2px solid ${theme.palette.primary.main}`,
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
          sx={{
            "& .MuiSpeedDial-fab": {
              position: "relative",
              border: (theme: any) => `2px solid ${theme.palette.primary.main}`,
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
