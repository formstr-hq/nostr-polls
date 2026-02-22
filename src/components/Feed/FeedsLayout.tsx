import React from "react";
import { Box, Tabs, Tab, useMediaQuery, useTheme } from "@mui/material";
import { useNavigate, useLocation, Outlet } from "react-router-dom";
import CreateFAB from "./CreateFAB";
import { useFeedScroll } from "../../contexts/FeedScrollContext";

const feedOptions = [
  { value: "polls", label: "Polls" },
  { value: "topics", label: "Topics" },
  { value: "notes", label: "Notes" },
  { value: "movies", label: "Movies" },
];

const FeedsLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { isScrolledDown, resetScroll } = useFeedScroll();

  // Extract feed from URL path like "/feeds/movies" -> "movies"
  const currentFeed = location.pathname.split("/")[2] || "polls";

  const handleChange = (_: any, newValue: string) => {
    resetScroll();
    navigate(`/feeds/${newValue}`);
  };

  return (
    <Box
      maxWidth={800}
      mx="auto"
      px={2}
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Feed-selector tabs animate out when scrolled down */}
      <Box
        sx={{
          overflow: "hidden",
          height: isScrolledDown ? 0 : "auto",
        }}
      >
        <Tabs
          value={currentFeed}
          onChange={handleChange}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{
            mb: 2,
            borderBottom: `1px solid ${theme.palette.divider}`,
            "& .MuiTab-root": {
              textTransform: "none",
              minWidth: isMobile ? 80 : 120,
              fontWeight: 500,
            },
          }}
        >
          {feedOptions.map((option) => (
            <Tab key={option.value} label={option.label} value={option.value} />
          ))}
        </Tabs>
      </Box>

      {/* Outlet fills remaining space */}
      <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <Outlet />
      </Box>
      <CreateFAB />
    </Box>
  );
};

export default FeedsLayout;
