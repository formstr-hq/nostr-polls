import React, { useState } from "react";
import { Box, ButtonBase, Typography } from "@mui/material";
import TagIcon from "@mui/icons-material/TagRounded";
import BookIcon from "@mui/icons-material/MenuBookRounded";
import MusicNoteIcon from "@mui/icons-material/MusicNoteRounded";
import MovieIcon from "@mui/icons-material/MovieRounded";
import GroupsIcon from "@mui/icons-material/GroupsRounded";
import GamesIcon from "@mui/icons-material/SportsEsportsRounded";
import SearchIcon from "@mui/icons-material/SearchRounded";
import { useNavigate } from "react-router-dom";
import { SearchModal } from "../Search/SearchModal";

const TILES = [
  { feed: "topics", label: "Topics", hint: "#hashtags & interests", Icon: TagIcon },
  { feed: "articles", label: "Articles", hint: "Long reads", Icon: BookIcon },
  { feed: "music", label: "Music", hint: "Playlists & tracks", Icon: MusicNoteIcon },
  { feed: "movies", label: "Movies", hint: "Rate & review", Icon: MovieIcon },
  { feed: "follow-packs", label: "Packs", hint: "Curated people", Icon: GroupsIcon },
  { feed: "games", label: "Games", hint: "2048 · Tetris · Racer", Icon: GamesIcon },
];

/** Hub for the secondary feeds, reached from the nav dock's Explore tab. */
const ExploreHub: React.FC = () => {
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  return (
    <Box sx={{ height: "100%", overflowY: "auto", px: 1.25, pt: 1.5, pb: 14 }}>
      <ButtonBase
        onClick={() => setSearchOpen(true)}
        sx={{
          width: "100%",
          height: 50,
          borderRadius: "18px",
          bgcolor: "cb.slab",
          justifyContent: "flex-start",
          gap: 1.25,
          px: 2,
          fontFamily: "inherit",
          fontSize: 15,
          color: "text.secondary",
          mb: 1.25,
        }}
      >
        <SearchIcon /> Search Pollerama
      </ButtonBase>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "1fr 1fr 1fr" }, gap: 1.25 }}>
        {TILES.map(({ feed, label, hint, Icon }) => (
          <ButtonBase
            key={feed}
            onClick={() => {
              localStorage.setItem("pollerama:lastFeed", feed);
              navigate(`/feeds/${feed}`);
            }}
            sx={{
              height: 116,
              borderRadius: "24px",
              bgcolor: "cb.slab",
              p: 1.75,
              flexDirection: "column",
              alignItems: "flex-start",
              justifyContent: "space-between",
              textAlign: "left",
              fontFamily: "inherit",
            }}
          >
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: "14px",
                bgcolor: "cb.block",
                color: "cb.onBlock",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon />
            </Box>
            <Box>
              <Typography sx={{ fontWeight: 800, fontSize: 16, lineHeight: 1.2 }}>{label}</Typography>
              <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>{hint}</Typography>
            </Box>
          </ButtonBase>
        ))}
      </Box>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </Box>
  );
};

export default ExploreHub;
