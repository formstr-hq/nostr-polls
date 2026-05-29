import React, { useState } from "react";
import { Button, Menu, MenuItem, ListItemIcon, ListItemText, Typography } from "@mui/material";
import PublicIcon from "@mui/icons-material/Public";
import LinkIcon from "@mui/icons-material/Link";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";

export type Audience =
  | { kind: "public" }
  | { kind: "private" };
  // Future: | { kind: "circle"; id: string; name: string }

interface AudienceOption {
  audience: Audience;
  label: string;
  hint: string;
  icon: React.ReactNode;
}

const OPTIONS: AudienceOption[] = [
  {
    audience: { kind: "public" },
    label: "Public",
    hint: "Visible to everyone on Nostr",
    icon: <PublicIcon fontSize="small" />,
  },
  {
    audience: { kind: "private" },
    label: "Private link",
    hint: "Only people with the link can read",
    icon: <LinkIcon fontSize="small" />,
  },
];

function optionFor(value: Audience): AudienceOption {
  return OPTIONS.find((o) => o.audience.kind === value.kind) ?? OPTIONS[0];
}

interface Props {
  value: Audience;
  onChange: (a: Audience) => void;
  disabled?: boolean;
}

export const AudienceMenu: React.FC<Props> = ({ value, onChange, disabled }) => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const current = optionFor(value);

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        disabled={disabled}
        startIcon={current.icon}
        endIcon={<ArrowDropDownIcon />}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ textTransform: "none", borderRadius: 999, alignSelf: "flex-start" }}
      >
        {current.label}
      </Button>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
      >
        {OPTIONS.map((o) => (
          <MenuItem
            key={o.audience.kind}
            selected={o.audience.kind === value.kind}
            onClick={() => {
              onChange(o.audience);
              setAnchor(null);
            }}
            sx={{ gap: 1 }}
          >
            <ListItemIcon>{o.icon}</ListItemIcon>
            <ListItemText
              primary={o.label}
              secondary={
                <Typography variant="caption" color="text.secondary">
                  {o.hint}
                </Typography>
              }
            />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};
