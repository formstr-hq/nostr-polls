import { Box, Modal, Tab, Tabs, Typography, useTheme } from "@mui/material";
import { useState } from "react";
import { RelaySettings } from "./RelaySettings";
import { AISettings } from "./AISettings";
import { BlossomSettings } from "./BlossomSettings";

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

  return (
    <Modal open={open} onClose={onClose}>
      <Box
        sx={{
          position: "absolute",
          top: "10%",
          left: "10%",
          width: "80%",
          borderRadius: 2,
          backgroundColor:
            theme.palette.mode === "dark" ? "#000000" : "#ffffff",
          boxShadow: 24,
          p: 4,
        }}
      >
        <Typography variant="h6" gutterBottom>
          Settings
        </Typography>

        <Tabs
          value={tabIndex}
          onChange={(_, newVal) => setTabIndex(newVal)}
          sx={{ mb: 2 }}
        >
          <Tab label="Relay Settings" />
          <Tab label="AI Settings" />
          <Tab label="Media" />
        </Tabs>

        {tabIndex === 0 && <RelaySettings />}
        {tabIndex === 1 && <AISettings />}
        {tabIndex === 2 && <BlossomSettings />}
      </Box>
    </Modal>
  );
};
