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
import { SUDOKU_SIZE, SUDOKU_SUBMIT_ACTION, SudokuAction, SudokuEngine } from "./engine";
import SudokuGrid, { SudokuCell, SudokuNotes, sudokuNoteKey } from "./Grid";
import SudokuReplay from "./Replay";
import { formatElapsed } from "./format";
import {
  SUDOKU_GAME_ID,
  getSudokuStreakForToday,
  hasStreak,
  verifySudokuStreak,
} from "./streak";
import GameLeaderboardModal from "../../components/Games/GameLeaderboardModal";
import ShareScoreButton from "../../components/Games/ShareScoreButton";
import { getAppBaseUrl } from "../../utils/platform";

const GAME_ID = SUDOKU_GAME_ID;
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
  const [notes, setNotes] = useState<SudokuNotes>(new Map());
  const [noteMode, setNoteMode] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [streak, setStreak] = useState<number | null>(null);
  const [failedChecks, setFailedChecks] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [bestToday, setBestToday] = useState<StoredScore | null>(null);
  const [publishedThisRun, setPublishedThisRun] = useState(false);
  const [watchingReplay, setWatchingReplay] = useState(false);
  const [finishedLog, setFinishedLog] = useState<GameInput[] | null>(null);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const publishingRef = useRef(false);
  const isBoardFull =
    board.length === SUDOKU_SIZE &&
    board.every((row) => row.length === SUDOKU_SIZE && row.every((value) => value !== 0));

  const clearCheckMessage = useCallback(() => {
    if (checkTimerRef.current) {
      clearTimeout(checkTimerRef.current);
      checkTimerRef.current = null;
    }
    setCheckMessage(null);
  }, []);

  const syncFromEngine = useCallback(() => {
    const engine = engineRef.current!;
    setBoard(engine.getBoard());
    setGivens(engine.getGivens());
    setFailedChecks(engine.getFailedChecks());
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
    setNotes(new Map());
    setNoteMode(false);
    clearCheckMessage();
    setSelected(firstEditableCell(engine.getGivens(), engine.getBoard()));
    syncFromEngine();
  }, [seed, syncFromEngine, clearCheckMessage]);

  useEffect(() => {
    resetGame();
    return clearCheckMessage;
  }, [resetGame, clearCheckMessage]);

  useEffect(() => {
    if (!user?.pubkey) return;
    setBestToday(null);
    setStreak(null);
    let alive = true;
    getMyTodayScore(GAME_ID, dateIso, user.pubkey).then((stored) => {
      if (!alive) return;
      // Don't clobber a streak published while this read was in flight.
      setBestToday((previous) => previous ?? stored);
      setStreak((previous) =>
        previous ?? (stored && hasStreak(stored.event) ? stored.score : null)
      );
    });
    return () => {
      alive = false;
    };
  }, [user?.pubkey, dateIso]);

  // Turn-based puzzle, but the fixed tick clock still has to advance exactly
  // like replay's logical clock so the elapsed time shown on the board (and
  // the engine's internal time score) is reproducible.
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

  const applyAction = useCallback(
    (action: SudokuAction) => {
      const engine = engineRef.current!;
      if (engine.isGameOver()) return;

      recorderRef.current!.record(action);
      const log = recorderRef.current!.getLog();
      const t = log[log.length - 1].t;
      tickSyncRef.current!.catchUpTo(engine, t);
      engine.applyInput(action, t);
      syncFromEngine();
    },
    [syncFromEngine]
  );

  const clearNotesForPlacement = useCallback((row: number, col: number, digit: number) => {
    setNotes((previous) => {
      if (previous.size === 0) return previous;
      const next = new Map(previous);
      next.delete(sudokuNoteKey(row, col));
      if (digit === 0) return next;

      // A placed digit eliminates that candidate from its row, column and box.
      for (const [key, candidates] of Array.from(next.entries())) {
        const [r, c] = key.split(",").map(Number);
        const sameBox =
          Math.floor(r / 3) === Math.floor(row / 3) &&
          Math.floor(c / 3) === Math.floor(col / 3);
        if ((r === row || c === col || sameBox) && candidates.has(digit)) {
          const updated = new Set(candidates);
          updated.delete(digit);
          if (updated.size > 0) next.set(key, updated);
          else next.delete(key);
        }
      }
      return next;
    });
  }, []);

  const setCellDigit = useCallback(
    (digit: number) => {
      const cell = selectedRef.current;
      if (!cell) return;
      clearCheckMessage();
      applyAction(`${cell.row},${cell.col},${digit}`);
      clearNotesForPlacement(cell.row, cell.col, digit);
    },
    [applyAction, clearCheckMessage, clearNotesForPlacement]
  );

  const toggleNote = useCallback(
    (digit: number) => {
      const cell = selectedRef.current;
      if (!cell) return;
      if ((board[cell.row]?.[cell.col] ?? 0) !== 0) return;
      const key = sudokuNoteKey(cell.row, cell.col);
      setNotes((previous) => {
        const next = new Map(previous);
        const candidates = new Set<number>(next.get(key) ?? []);
        if (candidates.has(digit)) candidates.delete(digit);
        else candidates.add(digit);
        if (candidates.size > 0) next.set(key, candidates);
        else next.delete(key);
        return next;
      });
    },
    [board]
  );

  const placeDigit = useCallback(
    (digit: number) => {
      if (noteMode) {
        if (digit >= 1 && digit <= 9) toggleNote(digit);
        return;
      }
      setCellDigit(digit);
    },
    [noteMode, toggleNote, setCellDigit]
  );

  const handleSubmit = useCallback(() => {
    const engine = engineRef.current!;
    if (engine.isGameOver()) return;
    if (!isBoardFull) return;

    clearCheckMessage();
    const failedBefore = engine.getFailedChecks();
    applyAction(SUDOKU_SUBMIT_ACTION);
    if (!engine.isGameOver() && engine.getFailedChecks() > failedBefore) {
      setCheckMessage("Not solved yet — keep going.");
      checkTimerRef.current = setTimeout(() => setCheckMessage(null), 2500);
    }
  }, [applyAction, clearCheckMessage, isBoardFull]);

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
          if ((givens[row]?.[col] ?? 0) === 0) {
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

      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        setNoteMode((mode) => !mode);
        return;
      }

      const offset = KEY_TO_OFFSET[event.key];
      if (offset) {
        event.preventDefault();
        clearCheckMessage();
        moveSelection(offset[0], offset[1]);
        return;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        placeDigit(0);
        return;
      }

      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault();
        placeDigit(Number(event.key));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    moveSelection,
    placeDigit,
    clearCheckMessage,
    gameOver,
    watchingReplay,
    leaderboardOpen,
  ]);

  useEffect(() => {
    if (!gameOver || publishedThisRun || publishingRef.current) return;
    if (!user?.pubkey) return;

    // A streak-format score already exists for today (this device or another).
    if (bestToday && hasStreak(bestToday.event)) {
      setStreak(bestToday.score);
      setPublishedThisRun(true);
      return;
    }

    publishingRef.current = true;
    (async () => {
      const nextStreak = await getSudokuStreakForToday(user.pubkey!, dateIso);
      setStreak(nextStreak);
      const signed = await publishDailyScore(
        GAME_ID,
        dateIso,
        seed,
        nextStreak,
        recorderRef.current!.getLog(),
        [["streak", String(nextStreak)]]
      );
      const stored = parseScoreEvent(signed);
      if (stored) {
        setBestToday(stored);
        setStreak(stored.score);
      }
      setPublishedThisRun(true);
    })()
      .catch((err) => console.error("Failed to publish Sudoku streak", err))
      .finally(() => {
        publishingRef.current = false;
      });
  }, [gameOver, bestToday, publishedThisRun, user?.pubkey, dateIso, seed]);

  return (
    <Stack alignItems="center" spacing={2} sx={{ p: 2, height: "100%", overflowY: "auto" }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="h5">Sudoku — {dateIso}</Typography>
        <IconButton size="small" onClick={() => setLeaderboardOpen(true)} aria-label="Leaderboard">
          <EmojiEventsIcon />
        </IconButton>
      </Stack>

      <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" justifyContent="center">
        <Typography>
          Streak: {streak ?? "—"}
          {streak !== null ? ` day${streak === 1 ? "" : "s"}` : ""}
        </Typography>
        <Typography>Time: {formatElapsed(elapsedMs)}</Typography>
        <Typography color={failedChecks > 0 ? "error" : "text.secondary"}>
          Failed checks: {failedChecks}
        </Typography>
      </Stack>

      {watchingReplay && finishedLog ? (
        <SudokuReplay seed={seed} inputLog={finishedLog} />
      ) : (
        <>
          <SudokuGrid
            board={board}
            givens={givens}
            selected={selected}
            notes={notes}
            onSelect={(row, col) => {
              clearCheckMessage();
              setSelected({ row, col });
            }}
            disabled={gameOver}
          />

          <Stack
            direction="row"
            spacing={1}
            sx={{ width: "min(92vw, 380px)" }}
          >
            <Button
              fullWidth
              variant={noteMode ? "contained" : "outlined"}
              color={noteMode ? "secondary" : "primary"}
              onClick={() => setNoteMode((mode) => !mode)}
              disabled={gameOver}
            >
              Notes {noteMode ? "on" : "off"}
            </Button>
            <Button
              fullWidth
              variant="contained"
              onClick={handleSubmit}
              disabled={gameOver || !isBoardFull}
            >
              Submit
            </Button>
          </Stack>

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
            <Button
              variant="outlined"
              onClick={() => placeDigit(0)}
              disabled={gameOver}
              sx={{ minWidth: 0, py: 1 }}
            >
              Erase
            </Button>
          </Box>

          {checkMessage && (
            <Typography color="error" fontWeight={600} textAlign="center">
              {checkMessage}
            </Typography>
          )}

          <Typography variant="caption" color="text.secondary" textAlign="center">
            Fill the grid freely, then press Submit to check. Nothing is revealed as you type.
            Notes mode pencils in candidates — N toggles it, Backspace erases a cell.
          </Typography>
        </>
      )}

      {gameOver && (
        <Typography color="success.main" fontWeight={600} textAlign="center">
          Solved in {formatElapsed(elapsedMs)} with {failedChecks} failed check
          {failedChecks === 1 ? "" : "s"}
          {streak !== null ? ` — ${streak}-day streak` : " — saving streak…"}
          {publishedThisRun ? " (saved)" : ""}
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
        {gameOver && streak !== null && (
          <ShareScoreButton
            gameLabel="Sudoku"
            gameId={GAME_ID}
            score={streak}
            dateIso={dateIso}
            shareText={`I'm on a ${streak}-day Sudoku streak on Pollerama! 🧩\n\nPlay today's puzzle: ${getAppBaseUrl()}/feeds/games/sudoku`}
          />
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
        verifyEntry={verifySudokuStreak}
        scoreSuffix="days"
      />
    </Stack>
  );
}
