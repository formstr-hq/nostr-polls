import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { DeterministicGame } from "../core/types";
import { Rng, randInt, rngFromHexSeed, seedToUint32 } from "../core/prng";

/** A digit-entry action, encoded as `"<row>,<col>,<digit>"` (all 0-based
 *  except the digit), or the literal `"submit"` to check the finished grid.
 *  Kept as compact strings so the shared input-log codec dedupes them down to
 *  a tiny dictionary. */
export type SudokuAction = string;

export const SUDOKU_SUBMIT_ACTION = "submit";

export const SUDOKU_SIZE = 9;
export type SudokuDifficulty = "easy" | "medium" | "hard";
/** Givens to aim for per difficulty. Fewer givens = harder puzzle. */
const TARGET_GIVENS: Record<SudokuDifficulty, number> = {
  easy: 42,
  medium: 36,
  hard: 30,
};
const DIFFICULTIES: SudokuDifficulty[] = ["easy", "medium", "hard"];
/** Score lost per whole second spent on the puzzle. */
const SECONDS_PENALTY = 2;
/** Score lost per failed Submit check. */
const FAILED_CHECK_PENALTY = 150;
/** Stop penalizing after 30 minutes. The shared replay harness only simulates
 *  ~60 minutes of ticks, so capping scoring well inside that keeps a very slow
 *  live solve's score reproducible instead of diverging past the tick bound. */
const MAX_SCORED_MS = 30 * 60 * 1000;
const BASE_SCORE = 10_000;

export interface SudokuPuzzle {
  /** 9x9 grid of givens, 0 = blank. */
  puzzle: number[][];
  /** The unique solution the givens were generated from. */
  solution: number[][];
  /** Difficulty implied by the number of remaining givens. */
  difficulty: SudokuDifficulty;
}

function classifyGivens(givens: number): SudokuDifficulty {
  if (givens >= 40) return "easy";
  if (givens >= 34) return "medium";
  return "hard";
}

function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build a complete valid grid from the standard "shifted pattern" Latin
 * square, then apply seeded permutations that preserve Sudoku validity:
 * digit relabelling, band/stack order, and row/column order within each band.
 * This gives a huge variety of solutions with no backtracking needed.
 */
function buildSolution(rng: Rng): number[][] {
  const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng);
  const bands = shuffle([0, 1, 2], rng);
  const stacks = shuffle([0, 1, 2], rng);
  const rows = bands.flatMap((band) =>
    shuffle([0, 1, 2], rng).map((row) => band * 3 + row)
  );
  const cols = stacks.flatMap((stack) =>
    shuffle([0, 1, 2], rng).map((col) => stack * 3 + col)
  );

  const pattern = (row: number, col: number) => (row * 3 + Math.floor(row / 3) + col) % 9;

  return rows.map((row) =>
    cols.map((col) => digits[pattern(row, col)])
  );
}

function popCount(mask: number): number {
  let n = 0;
  while (mask) {
    mask &= mask - 1;
    n++;
  }
  return n;
}

/** Counts solutions up to `limit` (2 is enough for a uniqueness check). */
function countSolutions(grid: number[][], limit: number): number {
  const rows = new Array(SUDOKU_SIZE).fill(0);
  const cols = new Array(SUDOKU_SIZE).fill(0);
  const boxes = new Array(SUDOKU_SIZE).fill(0);

  for (let r = 0; r < SUDOKU_SIZE; r++) {
    for (let c = 0; c < SUDOKU_SIZE; c++) {
      const value = grid[r][c];
      if (!value) continue;
      const bit = 1 << (value - 1);
      const box = Math.floor(r / 3) * 3 + Math.floor(c / 3);
      rows[r] |= bit;
      cols[c] |= bit;
      boxes[box] |= bit;
    }
  }

  const solve = (): number => {
    let bestRow = -1;
    let bestCol = -1;
    let bestMask = 0;
    let bestCount = SUDOKU_SIZE + 1;

    // Minimum-remaining-values heuristic keeps this fast even on a phone.
    for (let r = 0; r < SUDOKU_SIZE; r++) {
      for (let c = 0; c < SUDOKU_SIZE; c++) {
        if (grid[r][c] !== 0) continue;
        const box = Math.floor(r / 3) * 3 + Math.floor(c / 3);
        const mask = ~(rows[r] | cols[c] | boxes[box]) & 0x1ff;
        const count = popCount(mask);
        if (count === 0) return 0;
        if (count < bestCount) {
          bestCount = count;
          bestRow = r;
          bestCol = c;
          bestMask = mask;
          if (count === 1) break;
        }
      }
      if (bestCount === 1) break;
    }

    if (bestRow === -1) return 1; // no empty cells, valid solution

    const box = Math.floor(bestRow / 3) * 3 + Math.floor(bestCol / 3);
    let total = 0;
    let mask = bestMask;
    while (mask) {
      const bit = mask & -mask;
      mask &= mask - 1;
      const digit = Math.log2(bit) + 1;

      grid[bestRow][bestCol] = digit;
      rows[bestRow] |= bit;
      cols[bestCol] |= bit;
      boxes[box] |= bit;

      total += solve();
      if (total >= limit) {
        grid[bestRow][bestCol] = 0;
        rows[bestRow] &= ~bit;
        cols[bestCol] &= ~bit;
        boxes[box] &= ~bit;
        return total;
      }

      grid[bestRow][bestCol] = 0;
      rows[bestRow] &= ~bit;
      cols[bestCol] &= ~bit;
      boxes[box] &= ~bit;
    }
    return total;
  };

  return solve();
}

/** Remove givens one at a time, keeping the puzzle uniquely solvable. */
function generatePuzzle(seed: string): SudokuPuzzle {
  const difficulty = DIFFICULTIES[seedToUint32(seed) % DIFFICULTIES.length];
  const targetGivens = TARGET_GIVENS[difficulty];
  const rng = rngFromHexSeed(seed);
  const solution = buildSolution(rng);
  const puzzle = solution.map((row) => [...row]);
  const cells = shuffle(
    Array.from({ length: SUDOKU_SIZE * SUDOKU_SIZE }, (_, i) => i),
    rng
  );
  let givens = SUDOKU_SIZE * SUDOKU_SIZE;

  for (const index of cells) {
    if (givens <= targetGivens) break;
    const r = Math.floor(index / SUDOKU_SIZE);
    const c = index % SUDOKU_SIZE;
    const backup = puzzle[r][c];
    puzzle[r][c] = 0;
    if (countSolutions(puzzle, 2) === 1) {
      givens--;
    } else {
      puzzle[r][c] = backup;
    }
  }

  return { puzzle, solution, difficulty: classifyGivens(givens) };
}

/** Generating a puzzle involves a uniqueness solver, so memoize by seed: the
 *  live board and every leaderboard replay for the same day share one result. */
const puzzleCache = new Map<string, SudokuPuzzle>();
const MAX_CACHED_PUZZLES = 8;

export function getSudokuPuzzle(seed: string): SudokuPuzzle {
  const cached = puzzleCache.get(seed);
  if (cached) return cached;

  const puzzle = generatePuzzle(seed);
  if (puzzleCache.size >= MAX_CACHED_PUZZLES) {
    const oldest = puzzleCache.keys().next().value;
    if (oldest !== undefined) puzzleCache.delete(oldest);
  }
  puzzleCache.set(seed, puzzle);
  return puzzle;
}

export class SudokuEngine implements DeterministicGame<SudokuAction> {
  private daily: SudokuPuzzle = {
    puzzle: [],
    solution: [],
    difficulty: "medium",
  };
  private board: number[][] = [];
  private failedChecks = 0;
  private elapsedMs = 0;
  private gameOver = false;
  private finalScore = 0;
  /** Bumped on every visible mutation so the UI can skip idle rAF renders. */
  private version = 0;

  init(seed: string): void {
    this.daily = getSudokuPuzzle(seed);
    this.board = this.daily.puzzle.map((row) => [...row]);
    this.failedChecks = 0;
    this.elapsedMs = 0;
    this.gameOver = false;
    this.finalScore = 0;
    this.version++;
  }

  applyInput(action: SudokuAction, _t: number): void {
    if (this.gameOver) return;

    if (action === SUDOKU_SUBMIT_ACTION) {
      this.version++;
      if (this.isCorrect()) {
        this.gameOver = true;
        this.finalScore = this.computeScore();
      } else {
        // No per-cell reveal: a failed check only tells the player the puzzle
        // isn't solved yet, and costs a fixed score penalty.
        this.failedChecks++;
      }
      return;
    }

    const [row, col, digit] = action.split(",").map(Number);
    if (
      !Number.isInteger(row) ||
      !Number.isInteger(col) ||
      !Number.isInteger(digit) ||
      row < 0 ||
      row >= SUDOKU_SIZE ||
      col < 0 ||
      col >= SUDOKU_SIZE ||
      digit < 1 ||
      digit > 9
    ) {
      return;
    }

    // Givens are immutable. Every other cell is freely editable so players can
    // fill in their best guess and correct it before submitting.
    if (this.daily.puzzle[row][col] !== 0) return;
    if (this.board[row][col] === digit) return;

    this.board[row][col] = digit;
    this.version++;
  }

  private isCorrect(): boolean {
    for (let r = 0; r < SUDOKU_SIZE; r++) {
      for (let c = 0; c < SUDOKU_SIZE; c++) {
        if (this.board[r][c] !== this.daily.solution[r][c]) return false;
      }
    }
    return true;
  }

  /** Time only matters so far; failed Submit checks cost a fixed amount. */
  private computeScore(): number {
    const seconds = Math.floor(Math.min(this.elapsedMs, MAX_SCORED_MS) / 1000);
    return Math.max(
      0,
      BASE_SCORE - seconds * SECONDS_PENALTY - this.failedChecks * FAILED_CHECK_PENALTY
    );
  }

  tick(dtMs: number): void {
    if (this.gameOver) return;
    this.elapsedMs += dtMs;
  }

  getScore(): number {
    return this.gameOver ? this.finalScore : 0;
  }

  isGameOver(): boolean {
    return this.gameOver;
  }

  getStateHash(): string {
    const flat = `${this.board.flat().join("")}|${this.failedChecks}|${this.elapsedMs}|${this.finalScore}`;
    return bytesToHex(sha256(new TextEncoder().encode(flat))).slice(0, 16);
  }

  getBoard(): number[][] {
    return this.board.map((row) => [...row]);
  }

  getGivens(): number[][] {
    return this.daily.puzzle.map((row) => [...row]);
  }

  getDifficulty(): SudokuDifficulty {
    return this.daily.difficulty;
  }

  getFailedChecks(): number {
    return this.failedChecks;
  }

  getElapsedMs(): number {
    return this.elapsedMs;
  }

  getVersion(): number {
    return this.version;
  }
}
