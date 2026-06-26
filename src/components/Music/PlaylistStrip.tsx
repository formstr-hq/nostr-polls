import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Typography, ButtonBase, Chip } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import QueueMusicIcon from "@mui/icons-material/QueueMusic";
import PublicIcon from "@mui/icons-material/Public";
import { usePlaylists } from "../../contexts/playlists-context";
import NewPlaylistDialog from "./NewPlaylistDialog";

const CARD = 132;

// Horizontal strip of the user's local playlists at the top of the music feed,
// plus a "New playlist" card. Playlists are local-only, so this shows logged-out
// too. A "Local" badge distinguishes them from anything published to Nostr.
const PlaylistStrip: React.FC = () => {
  const { playlists } = usePlaylists();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);

  const list = playlists ? Array.from(playlists.values()) : [];

  const openPlaylist = (id: string) => navigate(`/feeds/music/${id}`);

  return (
    <Box sx={{ px: 2, pt: 2, pb: 1 }}>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
        Your playlists
      </Typography>
      <Box
        sx={{
          display: "flex",
          gap: 1.5,
          overflowX: "auto",
          pb: 1,
          scrollbarWidth: "thin",
        }}
      >
        {list.map((pl) => (
          <ButtonBase
            key={pl.id}
            onClick={() => openPlaylist(pl.id)}
            sx={{
              width: CARD,
              flexShrink: 0,
              display: "block",
              textAlign: "left",
              borderRadius: 2,
            }}
          >
            <Box
              sx={{
                position: "relative",
                width: CARD,
                height: CARD,
                borderRadius: 2,
                overflow: "hidden",
                bgcolor: "action.hover",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {pl.image ? (
                <Box
                  component="img"
                  src={pl.image}
                  alt={pl.title}
                  sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <QueueMusicIcon color="disabled" sx={{ fontSize: 48 }} />
              )}
              <Chip
                size="small"
                icon={pl.publishedNaddr ? <PublicIcon /> : undefined}
                label={pl.publishedNaddr ? "Public" : "Local"}
                sx={{
                  position: "absolute",
                  top: 6,
                  left: 6,
                  height: 20,
                  fontSize: "0.6rem",
                  bgcolor: "rgba(0,0,0,0.6)",
                  color: "common.white",
                  "& .MuiChip-icon": { color: "common.white", fontSize: 14 },
                }}
              />
            </Box>
            <Typography variant="body2" noWrap sx={{ mt: 0.5, fontWeight: 600 }}>
              {pl.title}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
              {pl.tracks.length} {pl.tracks.length === 1 ? "track" : "tracks"}
            </Typography>
          </ButtonBase>
        ))}

        <ButtonBase
          onClick={() => setDialogOpen(true)}
          sx={{ width: CARD, flexShrink: 0, display: "block", borderRadius: 2 }}
        >
          <Box
            sx={{
              width: CARD,
              height: CARD,
              borderRadius: 2,
              border: 1,
              borderStyle: "dashed",
              borderColor: "divider",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: "text.secondary",
            }}
          >
            <AddIcon />
            <Typography variant="caption">New playlist</Typography>
          </Box>
        </ButtonBase>
      </Box>

      <NewPlaylistDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={openPlaylist}
      />
    </Box>
  );
};

export default PlaylistStrip;
