import { sectionColorFrom } from "../Shell/useSectionColor";
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
import ArrowBackIcon from "@mui/icons-material/ArrowBackRounded";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import TuneIcon from "@mui/icons-material/Tune";
import PaletteIcon from "@mui/icons-material/Palette";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import PermMediaIcon from "@mui/icons-material/PermMedia";
import ShieldIcon from "@mui/icons-material/Shield";
import LanIcon from "@mui/icons-material/Lan";
import { useSearchParams } from "react-router-dom";
import { AISettings } from "../Header/AISettings";
import { BlossomSettings } from "../Header/BlossomSettings";
import { ModerationSettings } from "../Header/ModerationSettings";
import { AppearanceSettings } from "../Header/AppearanceSettings";
import { GeneralSettings } from "../Header/GeneralSettings";
import { NetworkSettings } from "../Header/NetworkSettings";

type SectionId =
  | "general"
  | "appearance"
  | "ai"
  | "media"
  | "moderation"
  | "network";

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
  {
    id: "network",
    label: "Network",
    description: "Relay connections, cache, and sync diagnostics",
    icon: <LanIcon />,
    render: () => <NetworkSettings />,
  },
];

export const SettingsScreen: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const theme = useTheme();
  // The open section lives in the URL (?section=appearance) so Android back and
  // deep links work; the block header's back button pops it like any page.
  const sectionParam = searchParams.get("section") as SectionId | null;
  const activeId = SECTIONS.some((s) => s.id === sectionParam) ? sectionParam : null;
  const setActiveId = (id: SectionId | null) =>
    setSearchParams(id ? { section: id } : {}, { replace: false });

  const active = activeId
    ? SECTIONS.find((s) => s.id === activeId) ?? null
    : null;

  const handleBack = () => setActiveId(null);

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: theme.palette.background.default,
      }}
    >
      {active && (
        <Box sx={{ display: "flex", alignItems: "center", px: 1, pt: 1.5 }}>
          <IconButton onClick={handleBack} edge="start" aria-label="All settings">
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" sx={{ ml: 0.5 }}>
            {active.label}
          </Typography>
        </Box>
      )}

      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {active ? (
          <Box sx={{ px: 2, py: 1.5, pb: 14 }}>{active.render()}</Box>
        ) : (
          <List
            disablePadding
            sx={{ mx: 1.25, mt: 1.5, borderRadius: "24px", bgcolor: "cb.slab", overflow: "hidden" }}
          >
            {SECTIONS.map((section, idx) => (
              <Box key={section.id}>
                <ListItemButton
                  onClick={() => setActiveId(section.id)}
                  sx={{ py: 1.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 52 }}>
                    <Box
                      sx={{
                        width: 38,
                        height: 38,
                        borderRadius: "12px",
                        background: sectionColorFrom(theme.palette.cb, idx).fill,
                        color: sectionColorFrom(theme.palette.cb, idx).on,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        "& svg": { fontSize: 20 },
                      }}
                    >
                      {section.icon}
                    </Box>
                  </ListItemIcon>
                  <ListItemText
                    primary={section.label}
                    secondary={section.description}
                    primaryTypographyProps={{ fontWeight: 700 }}
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
