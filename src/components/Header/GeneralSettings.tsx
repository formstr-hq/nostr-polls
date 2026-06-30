import React, { useState } from "react";
import {
  Box,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import {
  CLIENT_TAG_PRESETS,
  getClientTagName,
  isClientTagEnabled,
  setClientTagEnabled,
  setClientTagName,
} from "../../services/clientTagSettings";

const CUSTOM_OPTION = "__custom__";

export const GeneralSettings: React.FC = () => {
  const [enabled, setEnabled] = useState<boolean>(isClientTagEnabled());

  const initialName = getClientTagName();
  const initialIsPreset = CLIENT_TAG_PRESETS.includes(initialName);
  // Dropdown selection: a preset value, or CUSTOM_OPTION when the saved name
  // isn't one of the presets.
  const [selection, setSelection] = useState<string>(
    initialIsPreset ? initialName : CUSTOM_OPTION
  );
  const [customName, setCustomName] = useState<string>(
    initialIsPreset ? "" : initialName
  );

  const handleToggle = (_: React.ChangeEvent<HTMLInputElement>, checked: boolean) => {
    setClientTagEnabled(checked);
    setEnabled(checked);
  };

  const handleSelectChange = (value: string) => {
    setSelection(value);
    if (value === CUSTOM_OPTION) {
      // Persist whatever's currently in the custom field (may be empty).
      setClientTagName(customName);
    } else {
      setClientTagName(value);
    }
  };

  const handleCustomChange = (value: string) => {
    setCustomName(value);
    setClientTagName(value);
  };

  return (
    <Box p={2} sx={{ bgcolor: "background.paper", color: "text.primary" }}>
      <Typography variant="h6" gutterBottom>
        General
      </Typography>

      <Box mt={1}>
        <FormControlLabel
          control={<Switch checked={enabled} onChange={handleToggle} />}
          label="Add a client tag to events"
        />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          When enabled, every event you publish includes a{" "}
          <code>["client", "..."]</code> tag so other clients can show which app
          it was posted from. Off by default — turning it on reveals which client
          you're using.
        </Typography>

        {enabled && (
          <Box mt={2} sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 360 }}>
            <FormControl fullWidth size="small">
              <InputLabel id="client-tag-label">Client tag</InputLabel>
              <Select
                labelId="client-tag-label"
                label="Client tag"
                value={selection}
                onChange={(e) => handleSelectChange(e.target.value as string)}
              >
                {CLIENT_TAG_PRESETS.map((preset) => (
                  <MenuItem key={preset} value={preset}>
                    {preset}
                  </MenuItem>
                ))}
                <MenuItem value={CUSTOM_OPTION}>Custom…</MenuItem>
              </Select>
            </FormControl>

            {selection === CUSTOM_OPTION && (
              <TextField
                size="small"
                fullWidth
                label="Custom client tag"
                placeholder="Type anything you like"
                value={customName}
                onChange={(e) => handleCustomChange(e.target.value)}
                inputProps={{ maxLength: 64 }}
              />
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};
