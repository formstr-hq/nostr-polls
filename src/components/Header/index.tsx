import React, { useState, useEffect } from "react";
import { Box, IconButton, Badge, ButtonBase } from "@mui/material";
import MailIcon from "@mui/icons-material/MailRounded";
import SearchIcon from "@mui/icons-material/SearchRounded";
import ArrowBackIcon from "@mui/icons-material/ArrowBackRounded";
import { UserMenu } from "./UserMenu";
import { useLocation, useNavigate } from "react-router-dom";
import { NotificationBell } from "./NotificationBell";
import { useDMContext } from "../../hooks/useDMContext";
import { SearchModal } from "../Search/SearchModal";
import { useSubNav } from "../../contexts/SubNavContext";
import { isPollLocation, routeInfo } from "../Shell/navConfig";
import { useHeaderTitleOverride } from "../../contexts/HeaderTitleContext";

/**
 * Color Block header: a solid block of the theme color with a rounded bottom. It
 * holds whatever is in focus — the screen title and, on feeds, the sub-feed pills
 * (published by the mounted feed through SubNavContext).
 */
const Header: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { unreadTotal } = useDMContext();
  const { items: subNavItems } = useSubNav();
  const [searchOpen, setSearchOpen] = useState(false);
  const titleOverride = useHeaderTitleOverride();
  const info = {
    ...routeInfo(location.pathname),
    poll: isPollLocation(location.pathname, location.search),
  };
  // Pages publish pills via SubNavContext (feeds: sub-feeds; composer: Note/Poll)
  // and clear them on unmount.
  const showPills = subNavItems.length > 0;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  return (
    <>
      <Box
        component="header"
        data-testid="block-header"
        sx={{
          bgcolor: info.poll ? "cb.poll" : "cb.block",
          color: info.poll ? "cb.onPoll" : "cb.onBlock",
          borderBottomLeftRadius: 30,
          borderBottomRightRadius: 30,
          px: { xs: 1.5, sm: 2.5 },
          pb: showPills ? 1.75 : 1,
          transition: "background-color .25s ease",
          // Badges on the block invert it (block-colored text on the block's ink/white).
          "& .MuiBadge-badge": {
            bgcolor: info.poll ? "cb.onPoll" : "cb.onBlock",
            color: info.poll ? "cb.poll" : "cb.block",
            fontWeight: 800,
          },
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", minHeight: 56, gap: 0.5 }}>
          {info.topLevel ? (
            <UserMenu />
          ) : (
            <IconButton color="inherit" onClick={goBack} aria-label="Back" edge="start">
              <ArrowBackIcon />
            </IconButton>
          )}
          {titleOverride ? (
            <Box sx={{ flex: 1, minWidth: 0, ml: 0.5, fontWeight: 800, fontSize: 18 }}>{titleOverride}</Box>
          ) : (
          <ButtonBase
            onClick={() => navigate("/")}
            aria-label="Go home"
            sx={{
              flex: 1,
              minWidth: 0,
              justifyContent: "flex-start",
              ml: 1,
              borderRadius: 2,
              fontFamily: "inherit",
              fontWeight: 900,
              letterSpacing: "-0.035em",
              fontSize: info.topLevel ? { xs: 28, sm: 30 } : 20,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "block",
              textAlign: "left",
            }}
          >
            {info.title}
          </ButtonBase>
          )}
          <IconButton color="inherit" onClick={() => setSearchOpen(true)} aria-label="Search">
            <SearchIcon />
          </IconButton>
          <NotificationBell />
          <IconButton color="inherit" onClick={() => navigate("/messages")} aria-label="Messages">
            <Badge badgeContent={unreadTotal} invisible={unreadTotal === 0} max={99}>
              <MailIcon />
            </Badge>
          </IconButton>
        </Box>

        {showPills && (
          <Box
            role="tablist"
            sx={{
              display: "flex",
              gap: 1,
              overflowX: "auto",
              scrollbarWidth: "none",
              "&::-webkit-scrollbar": { display: "none" },
              mt: 0.25,
            }}
          >
            {subNavItems.map((item) => (
              <ButtonBase
                key={item.key}
                role="tab"
                aria-selected={item.active}
                disabled={item.disabled}
                onClick={() => !item.disabled && item.onClick()}
                sx={{
                  flex: "none",
                  height: 34,
                  px: 1.75,
                  borderRadius: 999,
                  fontFamily: "inherit",
                  fontWeight: 700,
                  fontSize: 14,
                  whiteSpace: "nowrap",
                  opacity: item.disabled ? 0.45 : 1,
                  bgcolor: item.active
                    ? info.poll ? "cb.onPoll" : "cb.onBlock"
                    : "cb.onBlockTint",
                  color: item.active
                    ? info.poll ? "cb.poll" : "cb.block"
                    : "inherit",
                }}
              >
                {/* Some sub-feed labels are lower-case ("my topics"); lift only the first letter. */}
                <Box component="span" sx={{ display: "inline-block", "&::first-letter": { textTransform: "uppercase" } }}>
                  {item.label}
                </Box>
              </ButtonBase>
            ))}
          </Box>
        )}
      </Box>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
};

export default Header;
