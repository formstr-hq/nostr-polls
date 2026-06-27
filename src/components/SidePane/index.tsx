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
import AllInclusiveIcon from "@mui/icons-material/AllInclusive";
import HowToVoteIcon from "@mui/icons-material/HowToVote";
import TagIcon from "@mui/icons-material/Tag";
import ArticleIcon from "@mui/icons-material/Article";
import BookIcon from "@mui/icons-material/MenuBook";
import MovieIcon from "@mui/icons-material/Movie";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import PeopleIcon from "@mui/icons-material/People";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import { SvgIconComponent } from "@mui/icons-material";
import { useNavigate, useLocation } from "react-router-dom";
import { useSubNav } from "../../contexts/SubNavContext";
import { safeSetItem } from "../../utils/localStorage";

// Static sub-item definitions — used for the mobile popup regardless of which
// feed is currently mounted. Active state is read from localStorage so we can
// show the correct selection even for feeds that aren't mounted yet.
const MOBILE_SUB_ITEMS: Record<string, { key: string; label: string }[]> = {
  home: [
    { key: "following", label: "Following" },
    { key: "network", label: "Network" },
  ],
  polls: [
    { key: "global", label: "Global" },
    { key: "following", label: "Following" },
    { key: "webOfTrust", label: "Web of Trust" },
  ],
  notes: [
    { key: "discover", label: "Network" },
    { key: "following", label: "Following" },
    { key: "reacted", label: "Reacted" },
    { key: "zapped", label: "Zapped" },
  ],
  topics: [
    { key: "interests", label: "Interests feed" },
    { key: "myTopics", label: "my topics" },
    { key: "discover", label: "discover topics" },
  ],
  "follow-packs": [
    { key: "global", label: "Global" },
    { key: "following", label: "Following" },
    { key: "bookmarked", label: "Bookmarked" },
  ],
  articles: [
    { key: "global", label: "Global" },
    { key: "following", label: "Following" },
  ],
  music: [
    { key: "discover", label: "Discover" },
    { key: "following", label: "Following" },
    { key: "local", label: "Local" },
  ],
};

const FEED_STORAGE_KEYS: Record<string, string> = {
  home: "pollerama:homeSource",
  polls: "pollerama:pollSource",
  notes: "pollerama:lastNotesTab",
  topics: "pollerama:lastTopicsTab",
  "follow-packs": "pollerama:followPacksSource",
  articles: "pollerama:articlesSource",
  music: "pollerama:musicSource",
};

const FEED_DEFAULT_SUB: Record<string, string> = {
  home: "following",
  polls: "global",
  notes: "discover",
  topics: "interests",
  "follow-packs": "global",
  articles: "global",
  music: "discover",
};

const feedOptions: { value: string; label: string; Icon: SvgIconComponent }[] = [
  { value: "home",         label: "Home",         Icon: AllInclusiveIcon },
  { value: "polls",        label: "Polls",        Icon: HowToVoteIcon },
  { value: "topics",       label: "Topics",       Icon: TagIcon },
  { value: "notes",        label: "Notes",        Icon: ArticleIcon },
  { value: "articles",     label: "Articles",     Icon: BookIcon },
  { value: "music",        label: "Music",        Icon: MusicNoteIcon },
  { value: "movies",       label: "Movies",       Icon: MovieIcon },
  { value: "follow-packs", label: "Packs",        Icon: PeopleIcon },
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
    if (MOBILE_SUB_ITEMS[feedValue]) {
      // Open sub-items popup (both mobile bottom nav and desktop sidebar)
      if (!isDesktop) {
        setMenuAnchor(e.currentTarget);
        setMenuFeed(feedValue);
        return;
      }
    }
    // Desktop feed with no sub-items, or direct nav: navigate
    localStorage.setItem("pollerama:lastFeed", feedValue);
    navigate(`/feeds/${feedValue}`);
  };

  const handleMobileSubItemClick = (subKey: string) => {
    if (!menuFeed) return;

    const storageKey = FEED_STORAGE_KEYS[menuFeed];
    if (storageKey) safeSetItem(storageKey, subKey);

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

  // ── Mobile: narrow icon sidebar with icons at the bottom ─────────────────
  if (!isDesktop) {
    return (
      <>
        <Box
          sx={{
            width: open ? 52 : 0,
            flexShrink: 0,
            height: "100%",
            borderRight: open ? `1px solid ${theme.palette.divider}` : "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            py: 1,
            overflowX: "hidden",
            overflowY: "auto",
            transition: "width 0.2s ease",
          }}
        >
          {/* Spacer pushes icons to the bottom */}
          <Box sx={{ flex: 1 }} />

          {feedOptions.map(({ value, label, Icon }) => {
            const active = currentFeed === value;
            return (
              <Tooltip key={value} title={label} placement="right">
                <IconButton
                  onClick={(e) => handleFeedClick(e, value)}
                  size="small"
                  sx={{
                    mb: 0.5,
                    color: active ? "primary.main" : "text.secondary",
                    bgcolor: active
                      ? alpha(theme.palette.primary.main, 0.12)
                      : "transparent",
                    borderRadius: 2,
                    "&:hover": {
                      bgcolor: active
                        ? alpha(theme.palette.primary.main, 0.18)
                        : alpha(theme.palette.text.primary, 0.06),
                    },
                  }}
                >
                  <Icon fontSize="small" />
                </IconButton>
              </Tooltip>
            );
          })}

          {/* Close button — pinned to bottom */}
          <Tooltip title="Hide sidebar" placement="right">
            <IconButton size="small" onClick={onToggle} sx={{ mt: 0.5 }}>
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        {/* Sub-items popup — anchored to the right of the icon */}
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
                      color: "secondary.main",
                      fontWeight: 600,
                      bgcolor: (t) => alpha(t.palette.secondary.main, 0.1),
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
  }

  // ── Desktop: left sidebar ─────────────────────────────────────────────────
  return (
    <>
      <Box
        sx={{
          width: open ? 200 : 0,
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

          return (
            <React.Fragment key={value}>
              <Box
                onClick={(e) => handleFeedClick(e, value)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  px: 2,
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
              </Box>

              {/* Desktop: inline sub-nav items below the active feed */}
              {active && subNavItems.length > 0 && (
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
                        // Sub-nav uses the secondary accent (the top-level feed
                        // selection above stays primary).
                        color: item.active ? "secondary.main" : "text.secondary",
                        fontWeight: item.active ? 600 : 400,
                        bgcolor: item.active
                          ? alpha(theme.palette.secondary.main, 0.08)
                          : "transparent",
                        "&:hover": item.disabled
                          ? {}
                          : {
                              bgcolor: item.active
                                ? alpha(theme.palette.secondary.main, 0.14)
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
        <Box sx={{ mt: "auto", display: "flex", justifyContent: "flex-end", px: 0.5, pb: 0.5 }}>
          <Tooltip title="Hide sidebar" placement="right">
            <IconButton size="small" onClick={onToggle}>
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Desktop: sub-nav popup (only opened from desktop when hasSubItems) */}
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
