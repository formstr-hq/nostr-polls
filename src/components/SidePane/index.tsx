import React, { useState } from "react";
import {
  Box,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import HowToVoteIcon from "@mui/icons-material/HowToVote";
import TagIcon from "@mui/icons-material/Tag";
import ArticleIcon from "@mui/icons-material/Article";
import MovieIcon from "@mui/icons-material/Movie";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import { SvgIconComponent } from "@mui/icons-material";
import { useNavigate, useLocation } from "react-router-dom";
import { useSubNav } from "../../contexts/SubNavContext";

// Static sub-item definitions — used for the mobile popup regardless of which
// feed is currently mounted. Active state is read from localStorage so we can
// show the correct selection even for feeds that aren't mounted yet.
const MOBILE_SUB_ITEMS: Record<string, { key: string; label: string }[]> = {
  polls: [
    { key: "global", label: "Global" },
    { key: "following", label: "Following" },
    { key: "webOfTrust", label: "Web of Trust" },
  ],
  notes: [
    { key: "discover", label: "Discover" },
    { key: "following", label: "Following" },
    { key: "reacted", label: "Reacted" },
  ],
  topics: [
    { key: "interests", label: "My Interests" },
    { key: "myTopics", label: "Topics" },
    { key: "discover", label: "Discover" },
  ],
};

const FEED_STORAGE_KEYS: Record<string, string> = {
  polls: "pollerama:pollSource",
  notes: "pollerama:lastNotesTab",
  topics: "pollerama:lastTopicsTab",
};

const FEED_DEFAULT_SUB: Record<string, string> = {
  polls: "global",
  notes: "discover",
  topics: "interests",
};

const feedOptions: { value: string; label: string; Icon: SvgIconComponent }[] = [
  { value: "polls",  label: "Polls",  Icon: HowToVoteIcon },
  { value: "topics", label: "Topics", Icon: TagIcon },
  { value: "notes",  label: "Notes",  Icon: ArticleIcon },
  { value: "movies", label: "Movies", Icon: MovieIcon },
];

interface NavSidebarProps {
  open: boolean;
  onToggle: () => void;
}

const NavSidebar: React.FC<NavSidebarProps> = ({ open, onToggle }) => {
  const navigate   = useNavigate();
  const location   = useLocation();
  const theme      = useTheme();
  const isDesktop  = useMediaQuery(theme.breakpoints.up("md"));
  const { items: subNavItems } = useSubNav();

  // Mobile popup state — tracks which feed's sub-menu is open
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuFeed, setMenuFeed] = useState<string | null>(null);

  const currentFeed = location.pathname.split("/")[2] || "polls";

  // Get the currently-active sub-key for any feed (from localStorage)
  const getActiveSub = (feedValue: string): string => {
    const storageKey = FEED_STORAGE_KEYS[feedValue];
    return storageKey
      ? (localStorage.getItem(storageKey) || FEED_DEFAULT_SUB[feedValue] || "")
      : "";
  };

  const handleFeedClick = (
    e: React.MouseEvent<HTMLElement>,
    feedValue: string
  ) => {
    if (!isDesktop && MOBILE_SUB_ITEMS[feedValue]) {
      // Mobile: open sub-items popup without navigating yet
      setMenuAnchor(e.currentTarget);
      setMenuFeed(feedValue);
      return;
    }
    // Desktop, or feed has no sub-items (movies): navigate directly
    localStorage.setItem("pollerama:lastFeed", feedValue);
    navigate(`/feeds/${feedValue}`);
  };

  const handleMobileSubItemClick = (subKey: string) => {
    if (!menuFeed) return;

    const storageKey = FEED_STORAGE_KEYS[menuFeed];
    if (storageKey) localStorage.setItem(storageKey, subKey);

    if (menuFeed === currentFeed) {
      // Feed is active — use the SubNavContext item's onClick to update live state
      const contextItem = subNavItems.find((item) => item.key === subKey);
      contextItem?.onClick();
    } else {
      // Feed is not active — navigate; it'll restore from localStorage on mount
      localStorage.setItem("pollerama:lastFeed", menuFeed);
      navigate(`/feeds/${menuFeed}`);
    }

    setMenuAnchor(null);
    setMenuFeed(null);
  };

  return (
    <>
      <Box
        sx={{
          width: open ? (isDesktop ? 200 : 52) : 0,
          flexShrink: 0,
          height: "100%",
          borderRight: open ? `1px solid ${theme.palette.divider}` : "none",
          display: "flex",
          flexDirection: "column",
          py: 1,
          overflowX: "hidden",
          overflowY: "auto",
          transition: "width 0.2s ease",
        }}
      >
        {feedOptions.map(({ value, label, Icon }) => {
          const active = currentFeed === value;

          const feedItem = (
            <Box
              onClick={(e) => handleFeedClick(e, value)}
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: isDesktop ? "flex-start" : "center",
                gap: isDesktop ? 1.5 : 0,
                px: isDesktop ? 2 : 0,
                py: 1.25,
                mx: 0.75,
                borderRadius: 2,
                cursor: "pointer",
                color: active ? "primary.main" : "text.secondary",
                bgcolor: active
                  ? alpha(theme.palette.primary.main, 0.12)
                  : "transparent",
                fontWeight: active ? 700 : 400,
                "&:hover": {
                  bgcolor: active
                    ? alpha(theme.palette.primary.main, 0.18)
                    : alpha(theme.palette.text.primary, 0.06),
                },
                transition: "background-color 0.15s, color 0.15s",
              }}
            >
              <Icon
                fontSize="small"
                sx={{ color: active ? "primary.main" : "text.secondary" }}
              />
              {isDesktop && (
                <Box
                  component="span"
                  sx={{
                    fontSize: "0.875rem",
                    fontWeight: "inherit",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </Box>
              )}
            </Box>
          );

          return (
            <React.Fragment key={value}>
              {/* Feed item — tooltip on mobile only */}
              {isDesktop ? (
                feedItem
              ) : (
                <Tooltip
                  title={MOBILE_SUB_ITEMS[value] ? `${label} ›` : label}
                  placement="right"
                  arrow
                >
                  <Box>{feedItem}</Box>
                </Tooltip>
              )}

              {/* Desktop: inline sub-nav items below the active feed */}
              {isDesktop && active && subNavItems.length > 0 && (
                <Box sx={{ mb: 0.5 }}>
                  {subNavItems.map((item) => (
                    <Box
                      key={item.key}
                      onClick={() => !item.disabled && item.onClick()}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        pl: 4.5,
                        pr: 2,
                        py: 0.75,
                        mx: 0.75,
                        borderRadius: 2,
                        cursor: item.disabled ? "default" : "pointer",
                        opacity: item.disabled ? 0.38 : 1,
                        color: item.active ? "primary.main" : "text.secondary",
                        fontWeight: item.active ? 600 : 400,
                        bgcolor: item.active
                          ? alpha(theme.palette.primary.main, 0.08)
                          : "transparent",
                        "&:hover": item.disabled
                          ? {}
                          : {
                              bgcolor: item.active
                                ? alpha(theme.palette.primary.main, 0.14)
                                : alpha(theme.palette.text.primary, 0.05),
                            },
                        transition: "background-color 0.15s, color 0.15s",
                      }}
                    >
                      <Typography
                        variant="body2"
                        sx={{
                          fontSize: "0.8rem",
                          fontWeight: "inherit",
                          color: "inherit",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.label}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </React.Fragment>
          );
        })}
        {/* Collapse button — pinned to bottom */}
        <Box sx={{ mt: "auto", display: "flex", justifyContent: isDesktop ? "flex-end" : "center", px: 0.5, pb: 0.5 }}>
          <Tooltip title="Hide sidebar" placement="right">
            <IconButton size="small" onClick={onToggle}>
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Mobile: sub-nav as a popup Menu (static config, active state from localStorage) */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => { setMenuAnchor(null); setMenuFeed(null); }}
        anchorOrigin={{ vertical: "center", horizontal: "right" }}
        transformOrigin={{ vertical: "center", horizontal: "left" }}
        slotProps={{ paper: { sx: { minWidth: 180 } } }}
      >
        {menuFeed &&
          (MOBILE_SUB_ITEMS[menuFeed] || []).map((item) => {
            // For the active feed, use the live context state (handles disabled etc.)
            const contextItem =
              menuFeed === currentFeed
                ? subNavItems.find((s) => s.key === item.key)
                : undefined;
            const isActive = contextItem
              ? contextItem.active
              : getActiveSub(menuFeed) === item.key;
            const isDisabled = contextItem ? !!contextItem.disabled : false;

            return (
              <MenuItem
                key={item.key}
                selected={isActive}
                disabled={isDisabled}
                onClick={() => handleMobileSubItemClick(item.key)}
                sx={{
                  fontSize: "0.875rem",
                  "&.Mui-selected": {
                    color: "primary.main",
                    fontWeight: 600,
                    bgcolor: (t) => alpha(t.palette.primary.main, 0.1),
                  },
                }}
              >
                {item.label}
              </MenuItem>
            );
          })}
      </Menu>
    </>
  );
};

export default NavSidebar;
