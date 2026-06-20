import { Box, Modal, Tab, Tabs, Typography, useTheme } from "@mui/material";
import { useState } from "react";
import { AISettings } from "./AISettings";
import { BlossomSettings } from "./BlossomSettings";
import { ModerationSettings } from "./ModerationSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { useBackClose } from "../../hooks/useBackClose";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
}) => {
  const [tabIndex, setTabIndex] = useState(0);
  const theme = useTheme();
  useBackClose(open, onClose);

  return (
    <Modal open={open} onClose={onClose}>
      <Box
        sx={{
          position: "absolute",
          top: { xs: 0, sm: "10%" },
          left: { xs: 0, sm: "10%" },
          width: { xs: "100%", sm: "80%" },
          height: { xs: "100%", sm: "auto" },
          maxHeight: { xs: "100%", sm: "80vh" },
          borderRadius: { xs: 0, sm: 2 },
          backgroundColor:
            theme.palette.mode === "dark" ? "#000000" : "#ffffff",
          boxShadow: 24,
          p: { xs: 2, sm: 4 },
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <Typography variant="h6" gutterBottom>
          Settings
        </Typography>

        <Tabs
          value={tabIndex}
          onChange={(_, newVal) => setTabIndex(newVal)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ mb: 2, minHeight: 36 }}
        >
          <Tab label="Appearance" />
          <Tab label="AI Settings" />
          <Tab label="Media" />
          <Tab label="Moderation" />
        </Tabs>

        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
          {tabIndex === 0 && <AppearanceSettings />}
          {tabIndex === 1 && <AISettings />}
          {tabIndex === 2 && <BlossomSettings />}
          {tabIndex === 3 && <ModerationSettings />}
        </Box>
      </Box>
    </Modal>
  );
};
