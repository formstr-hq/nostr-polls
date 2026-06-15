import React, { useState } from "react";
import {
  Box,
  FormControlLabel,
  Switch,
  Typography,
} from "@mui/material";
import {
  CLIENT_TAG_NAME,
  isClientTagEnabled,
  setClientTagEnabled,
} from "../../services/clientTagSettings";

export const GeneralSettings: React.FC = () => {
  const [clientTag, setClientTag] = useState<boolean>(isClientTagEnabled());

  const handleToggle = (_: React.ChangeEvent<HTMLInputElement>, checked: boolean) => {
    setClientTagEnabled(checked);
    setClientTag(checked);
  };

  return (
    <Box p={2} sx={{ bgcolor: "background.paper", color: "text.primary" }}>
      <Typography variant="h6" gutterBottom>
        General
      </Typography>

      <Box mt={1}>
        <FormControlLabel
          control={
            <Switch checked={clientTag} onChange={handleToggle} />
          }
          label={`Add "${CLIENT_TAG_NAME}" client tag to events`}
        />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          When enabled, every event you publish includes a{" "}
          <code>["client", "{CLIENT_TAG_NAME}"]</code> tag so other clients can
          show which app it was posted from. Off by default — turning it on
          reveals which client you're using.
        </Typography>
      </Box>
    </Box>
  );
};
