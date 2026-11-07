import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Button, IconButton, Stack, Typography } from "@mui/material";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import { useUserContext } from "../../hooks/useUserContext";
import { GameInput } from "../core/types";
import { InputRecorder } from "../core/inputRecorder";
import { TickSync } from "../core/tickSync";
import {
  StoredScore,
  getDailySeed,
  getMyTodayScore,
  parseScoreEvent,
  publishDailyScore,
  todayUtcIso,
} from "../core/scoreEvents";
import { SUDOKU_SIZE, SudokuAction, SudokuEngine } from "./engine";
import SudokuGrid, { SudokuCell } from "./Grid";
import SudokuReplay from "./Replay";
import { formatElapsed } from "./format";
import GameLeaderboardModal from "../../components/Games/GameLeaderboardModal";
import ShareScoreButton from "../../components/Games/ShareScoreButton";

const GAME_ID = "sudoku";
const sudokuFactory = () => new SudokuEngine();

const KEY_TO_OFFSET: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

function firstEditableCell(givens: number[][], board: number[][]): SudokuCell | null {
  for (let row = 0; row < SUDOKU_SIZE; row++) {
    for (let col = 0; col < SUDOKU_SIZE; col++) {
      if ((givens[row]?.[col] ?? 0) === 0 && (board[row]?.[col] ?? 0) === 0) {
        return { row, col };
      }
    }
  }
  return null;
}

export default function SudokuBoard() {
  const { user } = useUserContext();
  const dateIso = todayUtcIso();
  const seed = getDailySeed(GAME_ID, dateIso);

  const engineRef = useRef<SudokuEngine | null>(null);
  const recorderRef = useRef<InputRecorder | null>(null);
  const tickSyncRef = useRef<TickSync<SudokuAction> | null>(null);
  if (!engineRef.current) engineRef.current = new SudokuEngine();
  if (!recorderRef.current) recorderRef.current = new InputRecorder();
  if (!tickSyncRef.current) tickSyncRef.current = new TickSync();

  const [board, setBoard] = useState<number[][]>([]);
  const [givens, setGivens] = useState<number[][]>([]);
  const [selected, setSelected] = useState<SudokuCell | null>(null);
  const selectedRef = useRef<SudokuCell | null>(null);
  selectedRef.current = selected;
  const [wrongCell, setWrongCell] = useState<SudokuCell | null>(null);
  const wrongTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [score, setScore] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [bestToday, setBestToday] = useState<StoredScore | null>(null);
  const [publishedThisRun, setPublishedThisRun] = useState(false);
  const [watchingReplay, setWatchingReplay] = useState(false);
  const [finishedLog, setFinishedLog] = useState<GameInput[] | null>(null);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const publishingRef = useRef(false);

  const clearWrongCell = useCallback(() => {
    if (wrongTimerRef.current) {
      clearTimeout(wrongTimerRef.current);
      wrongTimerRef.current = null;
    }
    setWrongCell(null);
  }, []);

  const syncFromEngine = useCallback(() => {
    const engine = engineRef.current!;
    setBoard(engine.getBoard());
    setGivens(engine.getGivens());
    setScore(engine.getScore());
    setMistakes(engine.getMistakes());
    setElapsedMs(engine.getElapsedMs());
    if (engine.isGameOver()) {
      setGameOver(true);
      setFinishedLog([...recorderRef.current!.getLog()]);
    }
  }, []);

  const resetGame = useCallback(() => {
    const engine = engineRef.current!;
    engine.init(seed);
    recorderRef.current!.reset();
    tickSyncRef.current = new TickSync();
    setGameOver(false);
    setPublishedThisRun(false);
    setWatchingReplay(false);
    setFinishedLog(null);
    clearWrongCell();
    setSelected(firstEditableCell(engine.getGivens(), engine.getBoard()));
    syncFromEngine();
  }, [seed, syncFromEngine, clearWrongCell]);

  useEffect(() => {
    resetGame();
    return clearWrongCell;
  }, [resetGame, clearWrongCell]);

  useEffect(() => {
    if (!user?.pubkey) return;
    let alive = true;
    getMyTodayScore(GAME_ID, dateIso, user.pubkey).then((stored) => {
      if (alive && stored) setBestToday(stored);
    });
    return () => {
      alive = false;
    };
  }, [user?.pubkey, dateIso]);

  // The puzzle is turn-based, but the score is time-penalized, so the fixed
  // tick clock still has to advance exactly like replay's logical clock.
  useEffect(() => {
    let raf = 0;
    let lastVersion = -1;
    let lastSecond = -1;

    const loop = () => {
      const engine = engineRef.current!;
      if (!engine.isGameOver()) {
        tickSyncRef.current!.catchUpTo(engine, recorderRef.current!.elapsedNow());
        if (engine.getVersion() !== lastVersion) {
          lastVersion = engine.getVersion();
          syncFromEngine();
        }
        const second = Math.floor(engine.getElapsedMs() / 1000);
        if (second !== lastSecond) {
          lastSecond = second;
          setElapsedMs(engine.getElapsedMs());
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [syncFromEngine]);

  const doMove = useCallback(
    (action: SudokuAction) => {
      const engine = engineRef.current!;
      if (engine.isGameOver()) return;

      const [row, col] = action.split(",").map(Number);
      const mistakesBefore = engine.getMistakes();

      recorderRef.current!.record(action);
      const log = recorderRef.current!.getLog();
      const t = log[log.length - 1].t;
      tickSyncRef.current!.catchUpTo(engine, t);
      engine.applyInput(action, t);

      if (engine.getMistakes() > mistakesBefore) {
        clearWrongCell();
        setWrongCell({ row, col });
        wrongTimerRef.current = setTimeout(() => setWrongCell(null), 450);
      } else {
        clearWrongCell();
      }

      syncFromEngine();
    },
    [syncFromEngine, clearWrongCell]
  );

  const placeDigit = useCallback(
    (digit: number) => {
      const cell = selectedRef.current;
      if (!cell) return;
      doMove(`${cell.row},${cell.col},${digit}`);
    },
    [doMove]
  );

  const moveSelection = useCallback(
    (rowOffset: number, colOffset: number) => {
      setSelected((previous) => {
        const start = previous ?? firstEditableCell(givens, board);
        if (!start) return previous;
        let row = start.row;
        let col = start.col;
        for (let step = 0; step < SUDOKU_SIZE * SUDOKU_SIZE; step++) {
          row = (row + rowOffset + SUDOKU_SIZE) % SUDOKU_SIZE;
          col = (col + colOffset + SUDOKU_SIZE) % SUDOKU_SIZE;
          if (
            (givens[row]?.[col] ?? 0) === 0 &&
            (board[row]?.[col] ?? 0) === 0
          ) {
            return { row, col };
          }
        }
        return previous;
      });
    },
    [givens, board]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (gameOver || watchingReplay || leaderboardOpen) return;
      const offset = KEY_TO_OFFSET[event.key];
      if (offset) {
        event.preventDefault();
        clearWrongCell();
        moveSelection(offset[0], offset[1]);
        return;
      }

      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault();
        placeDigit(Number(event.key));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveSelection, placeDigit, clearWrongCell, gameOver, watchingReplay, leaderboardOpen]);

  useEffect(() => {
    if (!gameOver || publishedThisRun || publishingRef.current) return;
    if (!user?.pubkey) return;
    if (bestToday !== null && score <= bestToday.score) return;
    publishingRef.current = true;
    publishDailyScore(GAME_ID, dateIso, seed, score, recorderRef.current!.getLog())
      .then((signed) => {
        const stored = parseScoreEvent(signed);
        if (stored) setBestToday(stored);
        setPublishedThisRun(true);
      })
      .catch((err) => console.error("Failed to publish Sudoku score", err))
      .finally(() => {
        publishingRef.current = false;
      });
  }, [gameOver, score, bestToday, publishedThisRun, user?.pubkey, dateIso, seed]);

  return (
    <Stack alignItems="center" spacing={2} sx={{ p: 2, height: "100%", overflowY: "auto" }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="h5">Sudoku — {dateIso}</Typography>
        <IconButton size="small" onClick={() => setLeaderboardOpen(true)} aria-label="Leaderboard">
          <EmojiEventsIcon />
        </IconButton>
      </Stack>

      <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" justifyContent="center">
        <Typography>Score: {gameOver ? score : "—"}</Typography>
        <Typography>Time: {formatElapsed(elapsedMs)}</Typography>
        <Typography color={mistakes > 0 ? "error" : "text.secondary"}>
          Mistakes: {mistakes}
        </Typography>
        {bestToday ? (
          <Typography
            onClick={() => setLeaderboardOpen(true)}
            sx={{ cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted" }}
          >
            Today's best: {bestToday.score}
          </Typography>
        ) : (
          <Typography>Today's best: —</Typography>
        )}
      </Stack>

      {watchingReplay && finishedLog ? (
        <SudokuReplay seed={seed} inputLog={finishedLog} />
      ) : (
        <>
          <SudokuGrid
            board={board}
            givens={givens}
            selected={selected}
            wrongCell={wrongCell}
            onSelect={(row, col) => {
              clearWrongCell();
              setSelected({ row, col });
            }}
            disabled={gameOver}
          />

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: 1,
              width: "min(92vw, 380px)",
            }}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
              <Button
                key={digit}
                variant="outlined"
                onClick={() => placeDigit(digit)}
                disabled={gameOver}
                sx={{ fontSize: "1.15rem", fontWeight: 700, minWidth: 0, py: 1 }}
              >
                {digit}
              </Button>
            ))}
          </Box>

          <Typography variant="caption" color="text.secondary" textAlign="center">
            Tap a cell, then a number — or use arrow keys and 1–9. The timer keeps running
            while you think.
          </Typography>
        </>
      )}

      {gameOver && (
        <Typography color="success.main" fontWeight={600}>
          Solved in {formatElapsed(elapsedMs)} with {mistakes} mistake{mistakes === 1 ? "" : "s"} —
          score {score}
          {publishedThisRun ? " (published as today's best)" : ""}
        </Typography>
      )}

      <Stack direction="row" spacing={1}>
        {gameOver && finishedLog && (
          <Button variant="outlined" onClick={() => setWatchingReplay((w) => !w)}>
            {watchingReplay ? "Back to board" : "Watch replay"}
          </Button>
        )}
        <Button variant="outlined" onClick={resetGame}>
          Restart today's puzzle
        </Button>
        {gameOver && (
          <ShareScoreButton gameLabel="Sudoku" gameId={GAME_ID} score={score} dateIso={dateIso} />
        )}
      </Stack>

      <GameLeaderboardModal
        open={leaderboardOpen}
        onClose={() => setLeaderboardOpen(false)}
        label="Sudoku"
        gameId={GAME_ID}
        dateIso={dateIso}
        gameFactory={sudokuFactory}
        ReplayView={SudokuReplay}
      />
    </Stack>
  );
}
