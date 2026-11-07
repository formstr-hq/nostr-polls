import React from "react";
import { Box, Button, LinearProgress, Stack, Typography } from "@mui/material";
import { useReplayPlayback } from "../core/useReplayPlayback";
import { GameInput } from "../core/types";
import { SudokuEngine } from "./engine";
import SudokuGrid from "./Grid";
import { formatElapsed } from "./format";

const sudokuFactory = () => new SudokuEngine();
const SPEEDS = [1, 2, 4];

export interface SudokuReplayProps {
  seed: string;
  inputLog: GameInput[];
}

export default function SudokuReplay({ seed, inputLog }: SudokuReplayProps) {
  const playback = useReplayPlayback(sudokuFactory, seed, inputLog);
  const engine = playback.engine;
  const board = engine?.getBoard() ?? [];
  const givens = engine?.getGivens() ?? [];
  const score = engine?.getScore() ?? 0;
  const mistakes = engine?.getMistakes() ?? 0;
  const elapsedMs = engine?.getElapsedMs() ?? 0;
  const progress = playback.durationMs > 0 ? (playback.clockMs / playback.durationMs) * 100 : 0;

  return (
    <Stack alignItems="center" spacing={2} sx={{ p: 2 }}>
      <Stack direction="row" spacing={2}>
        <Typography variant="body1">Score: {score}</Typography>
        <Typography variant="body1">Time: {formatElapsed(elapsedMs)}</Typography>
        <Typography variant="body1">Mistakes: {mistakes}</Typography>
      </Stack>
      <SudokuGrid board={board} givens={givens} disabled />
      <Box sx={{ width: 320 }}>
        <LinearProgress variant="determinate" value={Math.min(100, progress)} />
      </Box>
      <Stack direction="row" spacing={1} alignItems="center">
        {playback.playing ? (
          <Button size="small" variant="outlined" onClick={playback.pause}>
            Pause
          </Button>
        ) : (
          <Button size="small" variant="contained" onClick={playback.play}>
            {playback.done ? "Replay again" : "Play"}
          </Button>
        )}
        <Button size="small" variant="outlined" onClick={playback.restart}>
          Restart
        </Button>
        {SPEEDS.map((s) => (
          <Button
            key={s}
            size="small"
            variant={playback.speed === s ? "contained" : "outlined"}
            onClick={() => playback.setSpeed(s)}
          >
            {s}x
          </Button>
        ))}
      </Stack>
    </Stack>
  );
}
