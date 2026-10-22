import React from "react";
import {
  Badge,
  Box,
  ButtonBase,
  IconButton,
  Tooltip,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import AllInclusiveIcon from "@mui/icons-material/AllInclusive";
import HowToVoteIcon from "@mui/icons-material/HowToVote";
import TagIcon from "@mui/icons-material/Tag";
import ArticleIcon from "@mui/icons-material/Article";
import BookIcon from "@mui/icons-material/MenuBook";
import MovieIcon from "@mui/icons-material/Movie";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import PeopleIcon from "@mui/icons-material/People";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
import SettingsIcon from "@mui/icons-material/SettingsRounded";
import DescriptionIcon from "@mui/icons-material/DescriptionRounded";
import AddIcon from "@mui/icons-material/AddRounded";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightIcon from "@mui/icons-material/ChevronRightRounded";
import { SvgIconComponent } from "@mui/icons-material";
import { useNavigate, useLocation } from "react-router-dom";
import { sectionIndex } from "../Shell/navConfig";
import { sectionColorFrom, useSectionColor } from "../Shell/useSectionColor";
import { UserMenu } from "../Header/UserMenu";
import { useDrafts } from "../../contexts/drafts-context";

const feedOptions: { value: string; label: string; Icon: SvgIconComponent }[] = [
  { value: "home",         label: "Home",         Icon: AllInclusiveIcon },
  { value: "polls",        label: "Polls",        Icon: HowToVoteIcon },
  { value: "topics",       label: "Topics",       Icon: TagIcon },
  { value: "notes",        label: "Notes",        Icon: ArticleIcon },
  { value: "articles",     label: "Articles",     Icon: BookIcon },
  { value: "music",        label: "Music",        Icon: MusicNoteIcon },
  { value: "movies",       label: "Movies",       Icon: MovieIcon },
  { value: "follow-packs", label: "Packs",        Icon: PeopleIcon },
  { value: "bookmarks",    label: "Bookmarks",    Icon: BookmarkIcon },
  { value: "games",        label: "Games",        Icon: SportsEsportsIcon },
];

/** Composer target for the current location (poll on Polls, hashtag on a topic). */
export function createPath(pathname: string): string {
  if (pathname.startsWith("/feeds/polls")) return "/create?type=poll";
  const topic = pathname.match(/\/feeds\/topics\/(.+)/);
  if (topic) return `/create?hashtag=${encodeURIComponent(topic[1])}`;
  return "/create";
}

export const RAIL_WIDTH = 236;
export const RAIL_COMPACT_WIDTH = 76;

interface NavSidebarProps {
  open: boolean;
  onToggle: () => void;
}

/**
 * Desktop navigation: an ink rail (the phone's nav dock, stood up) with the
 * account on top, every feed in its own palette color, and Create at the bottom.
 * Collapses to icons only. Mobile uses the floating NavDock instead.
 */
const NavSidebar: React.FC<NavSidebarProps> = ({ open, onToggle }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const section = useSectionColor();
  const { drafts } = useDrafts();
  const draftCount = drafts?.size ?? 0;

  if (!isDesktop) return null;

  const compact = !open;
  // Only feed routes highlight a rail item.
  const currentFeed = location.pathname.startsWith("/feeds")
    ? location.pathname.split("/")[2] || "polls"
    : "";

  const go = (feed: string) => {
    localStorage.setItem("pollerama:lastFeed", feed);
    navigate(`/feeds/${feed}`);
  };

  const itemSx = (active: boolean, accent?: string) => ({
    display: "flex",
    alignItems: "center",
    justifyContent: compact ? "center" : "flex-start",
    gap: 1.5,
    height: 44,
    px: compact ? 0 : 1.75,
    width: "100%",
    borderRadius: "16px",
    fontFamily: "inherit",
    fontSize: 14.5,
    fontWeight: active ? 800 : 600,
    whiteSpace: "nowrap",
    color: active ? "#111" : "rgba(255,255,255,0.62)",
    background: active ? accent : "transparent",
    transition: "background-color .15s, color .15s",
    "&:hover": {
      background: active ? accent : "rgba(255,255,255,0.08)",
      color: active ? "#111" : "#fff",
    },
  });

  const withTip = (label: string, node: React.ReactElement) =>
    compact ? (
      <Tooltip key={label} title={label} placement="right">
        {node}
      </Tooltip>
    ) : (
      <React.Fragment key={label}>{node}</React.Fragment>
    );

  return (
    <Box
      component="nav"
      aria-label="Primary"
      sx={{
        width: compact ? RAIL_COMPACT_WIDTH : RAIL_WIDTH,
        flexShrink: 0,
        my: 2,
        borderRadius: "30px",
        bgcolor: "cb.ink",
        color: "#fff",
        boxShadow: (t) => (t.palette.mode === "dark" ? "0 0 0 1px rgba(255,255,255,0.09)" : "none"),
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 0.25,
        p: compact ? 1.25 : 1.5,
        overflowX: "hidden",
        overflowY: "auto",
        scrollbarWidth: "none",
        transition: "width .2s ease",
      }}
    >
      {/* Account + settings */}
      <Box
        sx={{
          display: "flex",
          flexDirection: compact ? "column" : "row",
          alignItems: "center",
          gap: compact ? 1 : 0.5,
          pb: 1.5,
          minWidth: 0,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <UserMenu variant="rail" compact={compact} />
        </Box>
        <Tooltip title="Settings" placement="right">
          <IconButton
            onClick={() => navigate("/settings")}
            aria-label="Settings"
            sx={{ color: location.pathname.startsWith("/settings") ? "#fff" : "rgba(255,255,255,0.6)" }}
          >
            <SettingsIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {feedOptions.map(({ value, label, Icon }) => {
        const active = currentFeed === value;
        const accent = sectionColorFrom(theme.palette.cb, sectionIndex(`/feeds/${value}`)).accent;
        return withTip(
          label,
          <ButtonBase
            onClick={() => go(value)}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            sx={itemSx(active, accent)}
          >
            <Icon sx={{ fontSize: 21 }} />
            {!compact && label}
          </ButtonBase>,
        );
      })}

      <Box sx={{ flex: 1, minHeight: 12 }} />

      {withTip(
        "Drafts",
        <ButtonBase
          onClick={() => navigate("/drafts")}
          aria-label="Drafts"
          sx={itemSx(location.pathname.startsWith("/drafts"), "#fff")}
        >
          <Badge badgeContent={draftCount} color="primary" invisible={!compact || draftCount === 0} max={99}>
            <DescriptionIcon sx={{ fontSize: 21 }} />
          </Badge>
          {!compact && (
            <>
              Drafts
              {draftCount > 0 && (
                <Box component="span" sx={{ ml: "auto", fontSize: 12.5, opacity: 0.7 }}>
                  {draftCount}
                </Box>
              )}
            </>
          )}
        </ButtonBase>,
      )}

      {withTip(
        "Create",
        <ButtonBase
          onClick={() => navigate(createPath(location.pathname))}
          aria-label="Create"
          sx={{
            mt: 1,
            height: 54,
            borderRadius: "19px",
            gap: 1,
            fontFamily: "inherit",
            fontWeight: 800,
            fontSize: 15.5,
            background: section.fill,
            color: section.on,
          }}
        >
          <AddIcon sx={{ fontSize: 26 }} />
          {!compact && "Create"}
        </ButtonBase>,
      )}

      <Box sx={{ display: "flex", justifyContent: compact ? "center" : "flex-end", pt: 0.5 }}>
        <Tooltip title={compact ? "Expand sidebar" : "Collapse sidebar"} placement="right">
          <IconButton size="small" onClick={onToggle} sx={{ color: "rgba(255,255,255,0.5)" }}>
            {compact ? <ChevronRightIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
};

export default NavSidebar;
