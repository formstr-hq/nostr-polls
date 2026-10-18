import React from "react";
import { Box } from "@mui/material";
import { Outlet } from "react-router-dom";
import CreateFAB from "./CreateFAB";
import { FeedActionsProvider } from "../../contexts/FeedActionsContext";
import { useDockClearance } from "../Shell/NavDock";

const FeedsLayout: React.FC = () => {
  const dockClearance = useDockClearance();
  return (
    <FeedActionsProvider>
      <Box
        maxWidth={800}
        mx="auto"
        px={{ xs: 0, sm: 2 }}
        sx={{
          ...dockClearance,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <Outlet />
        </Box>
        <CreateFAB />
      </Box>
    </FeedActionsProvider>
  );
};

export default FeedsLayout;
