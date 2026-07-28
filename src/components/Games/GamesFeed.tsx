import React, { useEffect, useState } from "react";
import { Box, Button, Card, CardContent, Stack, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import { useUserContext } from "../../hooks/useUserContext";
import { getMyTodayScore, getMyTrackScore, todayUtcIso } from "../../games/core/scoreEvents";
import { Twenty48Engine } from "../../games/twenty48/engine";
import { TetrisEngine } from "../../games/tetris/engine";
import { RacerEngine } from "../../games/racer/engine";
import { Racer3DEngine } from "../../games/racer3d/engine/racer3dEngine";
import { buildTrack, TRACK_1 } from "../../games/racer3d/engine/track";
import Twenty48Replay from "../../games/twenty48/Replay";
import TetrisReplay from "../../games/tetris/Replay";
import RacerReplay from "../../games/racer/Replay";
import Racer3DReplay from "../../games/racer3d/components/Replay";
import GameLeaderboardModal from "./GameLeaderboardModal";

function formatRaceTime(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(2);
  return `${m}:${rest.padStart(5, "0")}`;
}

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
  {
    id: "racer3d",
    label: "Racer3D",
    path: "racer3d",
    factory: () => {
      const e = new Racer3DEngine();
      e.setTrack(buildTrack(TRACK_1));
      return e;
    },
    ReplayView: Racer3DReplay,
    trackId: "oval-thunder",
  },
] as const;

function GameCard({ id, label, path, factory, ReplayView, trackId }: (typeof GAMES)[number] & { trackId?: string }) {
  const { user } = useUserContext();
  const navigate = useNavigate();
  const dateIso = todayUtcIso();
  const [myBest, setMyBest] = useState<number | null>(null);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);

  useEffect(() => {
    if (!user?.pubkey) return;
    let alive = true;
    const load = trackId
      ? getMyTrackScore(id, trackId, user.pubkey)
      : getMyTodayScore(id, dateIso, user.pubkey);
    load.then((s) => {
      if (alive) setMyBest(s?.score ?? null);
    });
    return () => {
      alive = false;
    };
  }, [id, trackId, dateIso, user?.pubkey]);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">{label}</Typography>
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
          Your best {trackId ? "" : "today"}: {myBest ? (trackId ? formatRaceTime(myBest) : myBest) : "—"}
        </Typography>
      </CardContent>

      <GameLeaderboardModal
        open={leaderboardOpen}
        onClose={() => setLeaderboardOpen(false)}
        label={label}
        gameId={id}
        dateIso={dateIso}
        gameFactory={factory}
        trackId={trackId}
        ReplayView={ReplayView}
        formatScore={trackId ? formatRaceTime : undefined}
      />
    </Card>
  );
}

export default function GamesFeed() {
  return (
    <Box sx={{ p: 2, overflowY: "auto", height: "100%" }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <SportsEsportsIcon />
        <Typography variant="h5">Games</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Everyone gets the same board today — scores are verified by replaying each
        run's recorded moves against the daily seed, not by trusting a server.
      </Typography>
      <Stack spacing={2}>
        {GAMES.map((g) => (
          <GameCard key={g.id} {...g} />
        ))}
      </Stack>
    </Box>
  );
}
