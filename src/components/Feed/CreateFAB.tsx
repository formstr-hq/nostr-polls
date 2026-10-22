import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Badge, Box, ButtonBase, IconButton, SpeedDial, SpeedDialAction, SpeedDialIcon, Tooltip, useMediaQuery, useTheme } from "@mui/material";
import { HEADER_FEED_ACTIONS_ID } from "../Header";
import AddIcon from "@mui/icons-material/Add";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import RefreshIcon from "@mui/icons-material/Refresh";
import FiberNewIcon from "@mui/icons-material/FiberNew";
import DescriptionIcon from "@mui/icons-material/Description";
import { useNavigate, useLocation } from "react-router-dom";
import { useFeedActions } from "../../contexts/FeedActionsContext";
import { useNotification } from "../../contexts/notification-context";
import { useDrafts } from "../../contexts/drafts-context";
import { DOCK_BOTTOM, DOCK_FAB_SIZE } from "../Shell/NavDock";
import { useImmersiveHidden } from "../../contexts/ImmersiveScrollContext";
import { useSectionColor } from "../Shell/useSectionColor";

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
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const section = useSectionColor();
  const immersiveHidden = useImmersiveHidden();

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
    bgcolor: "cb.slab",
    color: "text.primary",
    border: "none",
  };

  const hasNewItems = newItemCount > 0;

  const renderDial = (corner: string) => (
        <SpeedDial
          ariaLabel="Feed actions"
          direction={corner.startsWith("t") ? "down" : "up"}
          // Create is the block color everywhere (Color Block).
          FabProps={{ color: "primary" }}
          sx={{
            "& .MuiSpeedDial-fab": {
              position: "relative",
              borderRadius: "22px",
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
            icon={
              <Badge badgeContent={draftCount} color="primary" invisible={draftCount === 0} max={99}>
                <DescriptionIcon />
              </Badge>
            }
            tooltipTitle={draftCount > 0 ? `Drafts (${draftCount})` : "Drafts"}
            onClick={handleOpenDrafts}
            sx={actionSx}
          />
          <SpeedDialAction
            icon={<AddIcon />}
            tooltipTitle="Create"
            onClick={handleCreate}
            sx={actionSx}
          />
        </SpeedDial>
);

  // Mobile: the dial sits in the nav dock's Create slot (bottom-right), styled as
  // a rounded square in the block color.
  if (!isDesktop) {
    return (
      <Box
        sx={{
          position: "fixed",
          right: 14,
          bottom: `calc(${DOCK_BOTTOM + 1}px + env(safe-area-inset-bottom))`,
          zIndex: 1150,
          // Leaves with the nav dock during immersive scrolling.
          transform: immersiveHidden && !open ? "translateY(calc(100% + 40px))" : "none",
          opacity: immersiveHidden && !open ? 0 : 1,
          transition: "transform .28s cubic-bezier(.2,0,0,1), opacity .2s ease",
          "& .MuiSpeedDial-fab": {
            width: DOCK_FAB_SIZE,
            height: DOCK_FAB_SIZE,
            borderRadius: "22px",
            border: "none !important",
            background: section.fill,
            color: section.on,
            "&:hover": { background: section.fill },
          },
        }}
      >
        {renderDial("br")}
      </Box>
    );
  }

  // Desktop: Create and Drafts live in the sidebar rail, and the feed actions
  // sit in the block header next to search (a corner button would cover the
  // cards, which fill the column on desktop).
  return <HeaderFeedActions extraActions={extraActions} />;
};

const HeaderFeedActions: React.FC<CreateFABProps> = ({ extraActions = [] }) => {
  const { isScrolledDown, scrollToTop, refresh, newItemCount, newItemLabel, showNewItems } =
    useFeedActions();
  const section = useSectionColor();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(document.getElementById(HEADER_FEED_ACTIONS_ID));
  }, []);
  if (!slot) return null;
  return createPortal(
    <>
      {newItemCount > 0 && (
        <ButtonBase
          onClick={showNewItems}
          sx={{
            height: 32,
            px: 1.5,
            mr: 0.5,
            borderRadius: 999,
            fontFamily: "inherit",
            fontWeight: 800,
            fontSize: 13,
            bgcolor: section.on,
            color: section.color,
            whiteSpace: "nowrap",
          }}
        >
          {newItemCount} new {newItemLabel}
        </ButtonBase>
      )}
      {isScrolledDown && (
        <Tooltip title="Back to top">
          <IconButton color="inherit" onClick={scrollToTop} aria-label="Back to top">
            <KeyboardArrowUpIcon />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title="Refresh">
        <IconButton color="inherit" onClick={refresh} aria-label="Refresh">
          <RefreshIcon />
        </IconButton>
      </Tooltip>
      {extraActions.map((action) => (
        <Tooltip key={action.name} title={action.name}>
          <IconButton color="inherit" onClick={action.onClick} aria-label={action.name}>
            {action.icon}
          </IconButton>
        </Tooltip>
      ))}
    </>,
    slot,
  );
};

export default CreateFAB;
