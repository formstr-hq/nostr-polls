import React from "react";
import { Box } from "@mui/material";
import { Outlet } from "react-router-dom";
import CreateFAB from "./CreateFAB";
import { FeedActionsProvider } from "../../contexts/FeedActionsContext";

const FeedsLayout: React.FC = () => {
  return (
    <FeedActionsProvider>
      <Box
        sx={{
          width: "100%",
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
