import { SUDOKU_SUBMIT_ACTION, SudokuEngine, getSudokuPuzzle } from "../engine";
import { verifyReplay } from "../../core/replayEngine";
import { GameInput } from "../../core/types";
import { TickSync } from "../../core/tickSync";

const SEED = "sudoku-determinism-test-seed";

function solutionInputs(seed: string, startMs = 0, stepMs = 900): GameInput[] {
  const { puzzle, solution } = getSudokuPuzzle(seed);
  const log: GameInput[] = [];
  let t = startMs;
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (puzzle[row][col] !== 0) continue;
      t += stepMs;
      log.push({ t, a: `${row},${col},${solution[row][col]}` });
    }
  }
  t += stepMs;
  log.push({ t, a: SUDOKU_SUBMIT_ACTION });
  return log;
}

function countGivens(seed: string): number {
  const { puzzle } = getSudokuPuzzle(seed);
  return puzzle.flat().filter((v) => v !== 0).length;
}

function isValidSolution(grid: number[][]): boolean {
  const expected = "123456789";
  for (let i = 0; i < 9; i++) {
    const row = grid[i].slice().sort().join("");
    const col = grid.map((r) => r[i]).sort().join("");
    const box = [0, 1, 2]
      .flatMap((dr) => [0, 1, 2].map((dc) => grid[Math.floor(i / 3) * 3 + dr][(i % 3) * 3 + dc]))
      .sort()
      .join("");
    if (row !== expected || col !== expected || box !== expected) return false;
  }
  return true;
}

describe("SudokuEngine", () => {
  test("daily puzzle is deterministic and valid", () => {
    const a = getSudokuPuzzle(SEED);
    const b = getSudokuPuzzle(SEED);
    expect(a).toBe(b); // memoized for the same day
    expect(countGivens(SEED)).toBeGreaterThanOrEqual(36);
    expect(countGivens(SEED)).toBeLessThan(81);
    expect(isValidSolution(a.solution)).toBe(true);

    // Every given matches the solution.
    const mismatches: string[] = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (a.puzzle[r][c] !== 0 && a.puzzle[r][c] !== a.solution[r][c]) {
          mismatches.push(`${r},${c}`);
        }
      }
    }
    expect(mismatches).toEqual([]);

    expect(getSudokuPuzzle(`${SEED}-other`).puzzle).not.toEqual(a.puzzle);
  });

  test("entering the solution completes the puzzle with a deterministic score", () => {
    const inputs = solutionInputs(SEED);

    const engine = new SudokuEngine();
    engine.init(SEED);
    const tickSync = new TickSync();
    expect(engine.isGameOver()).toBe(false);

    for (const input of inputs) {
      tickSync.catchUpTo(engine, input.t);
      engine.applyInput(input.a, input.t);
    }
    expect(engine.isGameOver()).toBe(true);
    expect(engine.getScore()).toBeGreaterThan(0);

    const replay = verifyReplay(() => new SudokuEngine(), SEED, inputs);
    expect(replay.gameOver).toBe(true);
    expect(replay.score).toBe(engine.getScore());
    expect(replay.stateHash).toBe(engine.getStateHash());
  });

  test("digits stay editable until Submit, and failed checks cost score", () => {
    const { puzzle, solution } = getSudokuPuzzle(SEED);
    let blankRow = -1;
    let blankCol = -1;
    for (let r = 0; r < 9 && blankRow === -1; r++) {
      for (let c = 0; c < 9; c++) {
        if (puzzle[r][c] === 0) {
          blankRow = r;
          blankCol = c;
          break;
        }
      }
    }
    const correct = solution[blankRow][blankCol];
    const wrong = correct === 9 ? 1 : correct + 1;

    // Wrong digits are placed verbatim — nothing is checked per cell.
    const probe = new SudokuEngine();
    probe.init(SEED);
    probe.applyInput(`${blankRow},${blankCol},${wrong}`, 100);
    expect(probe.getBoard()[blankRow][blankCol]).toBe(wrong);
    expect(probe.getFailedChecks()).toBe(0);
    expect(probe.isGameOver()).toBe(false);

    // ...and can be overwritten before submitting.
    probe.applyInput(`${blankRow},${blankCol},${correct}`, 200);
    expect(probe.getBoard()[blankRow][blankCol]).toBe(correct);

    // A failed Submit only increments the check counter, with no cell reveal.
    probe.applyInput(SUDOKU_SUBMIT_ACTION, 300);
    expect(probe.isGameOver()).toBe(false);
    expect(probe.getFailedChecks()).toBe(1);

    const clean = new SudokuEngine();
    clean.init(SEED);
    for (const input of solutionInputs(SEED)) clean.applyInput(input.a, input.t);

    const penalized = new SudokuEngine();
    penalized.init(SEED);
    penalized.applyInput(SUDOKU_SUBMIT_ACTION, 50);
    for (const input of solutionInputs(SEED)) {
      penalized.applyInput(input.a, input.t);
    }

    expect(clean.isGameOver()).toBe(true);
    expect(penalized.isGameOver()).toBe(true);
    expect(clean.getScore() - penalized.getScore()).toBe(150);
  });

  test("live TickSync playback matches headless replay", () => {
    for (const frameInterval of [16, 16.7, 17.3]) {
      const inputs = solutionInputs(SEED, 0, 337);
      const engine = new SudokuEngine();
      engine.init(SEED);
      const tickSync = new TickSync();
      let clock = 0;

      for (const input of inputs) {
        while (clock + frameInterval <= input.t) {
          clock += frameInterval;
          tickSync.catchUpTo(engine, clock);
        }
        tickSync.catchUpTo(engine, input.t);
        engine.applyInput(input.a, input.t);
      }

      const replay = verifyReplay(() => new SudokuEngine(), SEED, inputs);
      expect(engine.getScore()).toBe(replay.score);
      expect(engine.getStateHash()).toBe(replay.stateHash);
    }
  });
});
