import React from "react";
import {
  Box,
  IconButton,
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
import ExploreIcon from "@mui/icons-material/Explore";
import PublicIcon from "@mui/icons-material/Public";
import HubIcon from "@mui/icons-material/Hub";
import FavoriteIcon from "@mui/icons-material/FavoriteBorder";
import BoltIcon from "@mui/icons-material/Bolt";
import InterestsIcon from "@mui/icons-material/Interests";
import BookmarkIcon from "@mui/icons-material/BookmarkBorder";
import SmartphoneIcon from "@mui/icons-material/Smartphone";
import ViewListIcon from "@mui/icons-material/ViewList";
import { SvgIconComponent } from "@mui/icons-material";
import { useNavigate, useLocation } from "react-router-dom";
import { useSubNav } from "../../contexts/SubNavContext";

// Compact icons for the mobile rail's inline sub-feed list. Keys come from each
// feed's SubNavContext registration (item.key); unknown keys fall back to a list
// glyph and rely on the tooltip for the label.
const SUB_ICONS: Record<string, SvgIconComponent> = {
  following: PeopleIcon,
  network: ExploreIcon,
  discover: ExploreIcon,
  global: PublicIcon,
  webOfTrust: HubIcon,
  reacted: FavoriteIcon,
  zapped: BoltIcon,
  interests: InterestsIcon,
  myTopics: TagIcon,
  bookmarked: BookmarkIcon,
  local: SmartphoneIcon,
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

  const currentFeed = location.pathname.split("/")[2] || "polls";

  const handleFeedClick = (feedValue: string) => {
    // Tapping a feed icon navigates directly. Sub-feed selection is handled
    // inline in the rail (mobile) / under the active feed (desktop) — there's
    // no popup menu anymore (it was a two-tap interaction on mobile).
    localStorage.setItem("pollerama:lastFeed", feedValue);
    navigate(`/feeds/${feedValue}`);
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
              <React.Fragment key={value}>
                <Tooltip title={label} placement="right">
                  <IconButton
                    onClick={() => handleFeedClick(value)}
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

                {/* Active feed's sub-feeds, inline in the rail (single tap, no
                    popup, no extra horizontal bar). Mirrors the desktop sidebar's
                    inline sub-nav but icon-only to fit the 52px rail. */}
                {active &&
                  subNavItems.map((item) => {
                    const SubIcon = SUB_ICONS[item.key] || ViewListIcon;
                    return (
                      <Tooltip key={item.key} title={item.label} placement="right">
                        <span>
                          <IconButton
                            onClick={() => !item.disabled && item.onClick()}
                            disabled={item.disabled}
                            size="small"
                            sx={{
                              mb: 0.5,
                              p: 0.5,
                              // Sub-feeds use the secondary accent (top-level feed
                              // stays primary), matching the desktop sidebar.
                              color: item.active ? "secondary.main" : "text.disabled",
                              bgcolor: item.active
                                ? alpha(theme.palette.secondary.main, 0.14)
                                : "transparent",
                              borderRadius: 2,
                              "&:hover": {
                                bgcolor: item.active
                                  ? alpha(theme.palette.secondary.main, 0.2)
                                  : alpha(theme.palette.text.primary, 0.06),
                              },
                            }}
                          >
                            <SubIcon sx={{ fontSize: "1.05rem" }} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    );
                  })}
              </React.Fragment>
            );
          })}

          {/* Close button — pinned to bottom */}
          <Tooltip title="Hide sidebar" placement="right">
            <IconButton size="small" onClick={onToggle} sx={{ mt: 0.5 }}>
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
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
                onClick={() => handleFeedClick(value)}
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
    </>
  );
};

export default NavSidebar;
