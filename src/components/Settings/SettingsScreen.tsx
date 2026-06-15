import {
  Box,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  useTheme,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import TuneIcon from "@mui/icons-material/Tune";
import PaletteIcon from "@mui/icons-material/Palette";
import HubIcon from "@mui/icons-material/Hub";
import InsightsIcon from "@mui/icons-material/Insights";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import PermMediaIcon from "@mui/icons-material/PermMedia";
import ShieldIcon from "@mui/icons-material/Shield";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { RelaySettings } from "../Header/RelaySettings";
import { RelayAnalytics } from "../Header/RelayAnalytics";
import { AISettings } from "../Header/AISettings";
import { BlossomSettings } from "../Header/BlossomSettings";
import { ModerationSettings } from "../Header/ModerationSettings";
import { AppearanceSettings } from "../Header/AppearanceSettings";
import { GeneralSettings } from "../Header/GeneralSettings";

type SectionId =
  | "general"
  | "appearance"
  | "relays"
  | "relayAnalytics"
  | "ai"
  | "media"
  | "moderation";

interface SectionDef {
  id: SectionId;
  label: string;
  description: string;
  icon: React.ReactNode;
  render: () => React.ReactNode;
}

const SECTIONS: SectionDef[] = [
  {
    id: "general",
    label: "General",
    description: "Client tag and publishing options",
    icon: <TuneIcon />,
    render: () => <GeneralSettings />,
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme, accent color, and fonts",
    icon: <PaletteIcon />,
    render: () => <AppearanceSettings />,
  },
  {
    id: "relays",
    label: "Relays",
    description: "Manage the relays you publish to",
    icon: <HubIcon />,
    render: () => <RelaySettings />,
  },
  {
    id: "relayAnalytics",
    label: "Relay Analytics",
    description: "See how your relays are performing",
    icon: <InsightsIcon />,
    render: () => <RelayAnalytics />,
  },
  {
    id: "ai",
    label: "AI",
    description: "AI provider and model preferences",
    icon: <SmartToyIcon />,
    render: () => <AISettings />,
  },
  {
    id: "media",
    label: "Media",
    description: "Blossom server for image and video uploads",
    icon: <PermMediaIcon />,
    render: () => <BlossomSettings />,
  },
  {
    id: "moderation",
    label: "Moderation",
    description: "Reports, mutes, and content filters",
    icon: <ShieldIcon />,
    render: () => <ModerationSettings />,
  },
];

export const SettingsScreen: React.FC = () => {
  const [activeId, setActiveId] = useState<SectionId | null>(null);
  const navigate = useNavigate();
  const theme = useTheme();

  const active = activeId
    ? SECTIONS.find((s) => s.id === activeId) ?? null
    : null;

  const handleBack = () => {
    if (active) setActiveId(null);
    else navigate(-1);
  };

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: theme.palette.background.default,
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          px: 1,
          py: 1,
          borderBottom: active ? 1 : 0,
          borderColor: "divider",
        }}
      >
        <IconButton onClick={handleBack} edge="start" aria-label="Back">
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h6" sx={{ ml: 1 }}>
          {active ? active.label : "Settings"}
        </Typography>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {active ? (
          active.render()
        ) : (
          <List disablePadding>
            {SECTIONS.map((section, idx) => (
              <Box key={section.id}>
                <ListItemButton
                  onClick={() => setActiveId(section.id)}
                  sx={{ py: 1.5 }}
                >
                  <ListItemIcon sx={{ color: "text.secondary", minWidth: 44 }}>
                    {section.icon}
                  </ListItemIcon>
                  <ListItemText
                    primary={section.label}
                    secondary={section.description}
                    primaryTypographyProps={{ fontWeight: 500 }}
                  />
                  <ChevronRightIcon sx={{ color: "text.secondary" }} />
                </ListItemButton>
                {idx < SECTIONS.length - 1 && (
                  <Divider variant="inset" component="li" sx={{ ml: 7 }} />
                )}
              </Box>
            ))}
          </List>
        )}
      </Box>
    </Box>
  );
};
