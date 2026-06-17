import React from "react";
import { Tabs, Tab, useTheme, useMediaQuery, Box } from "@mui/material";

interface Props {
  activeTab: "following" | "reacted" | "discover"; // 🆕
  setActiveTab: (tab: "following" | "reacted" | "discover") => void;
}

const NotesFeedTabs: React.FC<Props> = ({ activeTab, setActiveTab }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  return (
    <Box sx={{ borderBottom: `1px solid ${theme.palette.divider}`, mb: 2 }}>
      <Tabs
        value={activeTab}
        onChange={(_, newValue: "following" | "reacted") =>
          setActiveTab(newValue)
        }
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{
          "& .MuiTab-root": {
            textTransform: "none",
            minWidth: isMobile ? 100 : 160,
            fontWeight: 500,
          },
        }}
      >
        <Tab label="Network" value="discover" /> {/* 🆕 */}
        <Tab label="Following" value="following" />
        <Tab label="Reacted by Contacts" value="reacted" />
      </Tabs>
    </Box>
  );
};

export default NotesFeedTabs;
