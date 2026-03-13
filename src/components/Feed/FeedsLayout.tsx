import React from "react";
import { Box } from "@mui/material";
import { Outlet } from "react-router-dom";
import CreateFAB from "./CreateFAB";

const FeedsLayout: React.FC = () => {
  return (
    <Box
      maxWidth={800}
      mx="auto"
      px={{ xs: 0, sm: 2 }}
      sx={{
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
  );
};

export default FeedsLayout;
