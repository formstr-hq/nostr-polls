import React from "react";
import { Box, ButtonBase, useMediaQuery, useTheme } from "@mui/material";
import { alpha } from "@mui/material/styles";
import HomeIcon from "@mui/icons-material/HomeRounded";
import PollIcon from "@mui/icons-material/PollRounded";
import NotesIcon from "@mui/icons-material/ArticleRounded";
import ExploreIcon from "@mui/icons-material/ExploreRounded";
import BookmarkIcon from "@mui/icons-material/BookmarkRounded";
import AddIcon from "@mui/icons-material/AddRounded";
import { useLocation, useNavigate } from "react-router-dom";
import { dockKey, routeInfo } from "./navConfig";

const DESTINATIONS = [
  { key: "home", label: "Home", Icon: HomeIcon, to: "/feeds/home" },
  { key: "polls", label: "Polls", Icon: PollIcon, to: "/feeds/polls" },
  { key: "notes", label: "Notes", Icon: NotesIcon, to: "/feeds/notes" },
  { key: "explore", label: "Explore", Icon: ExploreIcon, to: "/feeds/explore" },
  { key: "saved", label: "Saved", Icon: BookmarkIcon, to: "/feeds/bookmarks" },
];

/** Height reserved under scrolling content so the floating dock never covers it. */
export const DOCK_CLEARANCE = 96;

/** Size/offset shared with CreateFAB, which occupies the dock's right-hand slot on feeds. */
export const DOCK_BOTTOM = 18;
export const DOCK_FAB_SIZE = 60;

/**
 * Mobile navigation: a floating ink dock with the five primary destinations, plus
 * a Create button in the block color. On feed routes CreateFAB (the speed dial with
 * refresh / back-to-top / drafts) takes the Create slot instead.
 */
const NavDock: React.FC = () => {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const location = useLocation();
  const navigate = useNavigate();
  if (isDesktop) return null;
  const info = routeInfo(location.pathname);
  if (info.hideDock) return null;
  const active = dockKey(location.pathname);
  const onFeeds = location.pathname.startsWith("/feeds");

  return (
    <>
    {/* Content fades out under the floating dock instead of cutting off hard. */}
    <Box
      aria-hidden
      sx={(t) => ({
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: `calc(${DOCK_CLEARANCE + 12}px + env(safe-area-inset-bottom))`,
        background: `linear-gradient(${alpha(t.palette.cb.page, 0)}, ${alpha(t.palette.cb.page, 0.92)} 55%)`,
        pointerEvents: "none",
        zIndex: 1099,
      })}
    />
    <Box
      component="nav"
      aria-label="Primary"
      data-testid="nav-dock"
      sx={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: `calc(${DOCK_BOTTOM}px + env(safe-area-inset-bottom))`,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 1.25,
        // Leave room on the right for the Create button.
        pr: `${DOCK_FAB_SIZE + 10}px`,
        pl: 1,
        zIndex: 1100,
        pointerEvents: "none",
      }}
    >
      <Box
        sx={{
          display: "flex",
          gap: 0.25,
          p: 0.75,
          borderRadius: "26px",
          bgcolor: "cb.ink",
          boxShadow: (t) =>
            t.palette.mode === "dark"
              ? "0 0 0 1px rgba(255,255,255,0.09)"
              : "0 16px 34px -12px rgba(0,0,0,0.55)",
          pointerEvents: "auto",
        }}
      >
        {DESTINATIONS.map(({ key, label, Icon, to }) => {
          const on = active === key;
          return (
            <ButtonBase
              key={key}
              onClick={() => {
                if (to.startsWith("/feeds/") && key !== "explore") {
                  localStorage.setItem("pollerama:lastFeed", to.split("/")[2]);
                }
                navigate(to);
              }}
              aria-label={label}
              aria-current={on ? "page" : undefined}
              sx={{
                width: { xs: 54, sm: 64 },
                height: 50,
                borderRadius: "20px",
                flexDirection: "column",
                gap: "2px",
                fontFamily: "inherit",
                fontSize: 10.5,
                fontWeight: 700,
                color: on ? "#111" : "rgba(255,255,255,0.62)",
                bgcolor: on ? (key === "polls" ? "cb.accentPoll" : "cb.accent") : "transparent",
                transition: "background-color .2s, color .2s",
              }}
            >
              <Icon sx={{ fontSize: 22 }} />
              {label}
            </ButtonBase>
          );
        })}
      </Box>
      {!onFeeds && (
        <ButtonBase
          onClick={() => navigate("/create")}
          aria-label="Create"
          sx={{
            position: "absolute",
            right: 14,
            width: DOCK_FAB_SIZE,
            height: DOCK_FAB_SIZE,
            borderRadius: "22px",
            bgcolor: "cb.block",
            color: "cb.onBlock",
            pointerEvents: "auto",
            boxShadow: "0 14px 28px -12px rgba(0,0,0,0.5)",
          }}
        >
          <AddIcon sx={{ fontSize: 30 }} />
        </ButtonBase>
      )}
    </Box>
    </>
  );
};

export default NavDock;
