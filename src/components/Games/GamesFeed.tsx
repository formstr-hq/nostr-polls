import { useSectionColorAt } from "../Shell/useSectionColor";
import React, { useEffect, useState } from "react";
import { Box, Button, Card, CardContent, Stack, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import { useUserContext } from "../../hooks/useUserContext";
import { getMyTodayScore, todayUtcIso } from "../../games/core/scoreEvents";
import { Twenty48Engine } from "../../games/twenty48/engine";
import { TetrisEngine } from "../../games/tetris/engine";
import { RacerEngine } from "../../games/racer/engine";
import Twenty48Replay from "../../games/twenty48/Replay";
import TetrisReplay from "../../games/tetris/Replay";
import RacerReplay from "../../games/racer/Replay";
import GameLeaderboardModal from "./GameLeaderboardModal";

// Module-level so the factory reference is stable across renders — the
// leaderboard hook keys off it via a ref, not a dependency, but a stable
// reference still avoids handing it a fresh closure every render for no reason.
const GAMES = [
  {
    id: "2048",
    label: "2048",
    path: "2048",
    factory: () => new Twenty48Engine(),
    ReplayView: Twenty48Replay,
  },
  {
    id: "tetris",
    label: "Tetris",
    path: "tetris",
    factory: () => new TetrisEngine(),
    ReplayView: TetrisReplay,
  },
  {
    id: "racer",
    label: "Overdrive",
    path: "racer",
    factory: () => new RacerEngine(),
    ReplayView: RacerReplay,
  },
] as const;

function GameCard({ id, label, path, factory, ReplayView }: (typeof GAMES)[number]) {
  const { user } = useUserContext();
  const navigate = useNavigate();
  const dateIso = todayUtcIso();
  const [myBest, setMyBest] = useState<number | null>(null);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  // Each game gets its own palette color.
  const tint = useSectionColorAt(GAMES.findIndex((g) => g.id === id) + 3);

  useEffect(() => {
    if (!user?.pubkey) return;
    let alive = true;
    getMyTodayScore(id, dateIso, user.pubkey).then((s) => {
      if (alive) setMyBest(s?.score ?? null);
    });
    return () => {
      alive = false;
    };
  }, [id, dateIso, user?.pubkey]);

  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
            <Box sx={{ width: 40, height: 40, borderRadius: "13px", background: tint.fill, color: tint.on, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <SportsEsportsIcon />
            </Box>
            <Typography variant="h6">{label}</Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<EmojiEventsIcon />}
              onClick={() => setLeaderboardOpen(true)}
            >
              Leaderboard
            </Button>
            <Button size="small" variant="contained" onClick={() => navigate(path)}>
              Play
            </Button>
          </Stack>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Your best today: {myBest ?? "—"}
        </Typography>
      </CardContent>

      <GameLeaderboardModal
        open={leaderboardOpen}
        onClose={() => setLeaderboardOpen(false)}
        label={label}
        gameId={id}
        dateIso={dateIso}
        gameFactory={factory}
        ReplayView={ReplayView}
      />
    </Card>
  );
}

export default function GamesFeed() {
  return (
    <Box sx={{ p: 1.25, pt: 1.5, overflowY: "auto", height: "100%" }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, px: 0.5 }}>
        Everyone gets the same board today — scores are verified by replaying each
        run's recorded moves against the daily seed, not by trusting a server.
      </Typography>
      <Stack spacing={1.25}>
        {GAMES.map((g) => (
          <GameCard key={g.id} {...g} />
        ))}
      </Stack>
    </Box>
  );
}
