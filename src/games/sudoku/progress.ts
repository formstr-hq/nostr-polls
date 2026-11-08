import { safeSetItem } from "../../utils/localStorage";
import type { GameInput } from "../core/types";
import type { SudokuCell } from "./Grid";

const PROGRESS_KEY = "pollerama:sudoku:progress:v1";

export type StoredNotes = [string, number[]][];

export interface SudokuProgress {
  seed: string;
  dateIso: string;
  log: GameInput[];
  elapsedMs: number;
  notes: StoredNotes;
  selected: SudokuCell | null;
  noteMode: boolean;
}

export function serializeNotes(
  notes: Map<string, Set<number>>
): StoredNotes {
  return Array.from(notes.entries()).map(([key, digits]) => [
    key,
    Array.from(digits),
  ]);
}

export function deserializeNotes(notes: StoredNotes): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const entry of notes) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [key, digits] = entry;
    if (typeof key !== "string" || !Array.isArray(digits)) continue;
    map.set(
      key,
      new Set(digits.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 9))
    );
  }
  return map;
}

export function saveSudokuProgress(progress: SudokuProgress): void {
  safeSetItem(PROGRESS_KEY, JSON.stringify(progress));
}

export function clearSudokuProgress(): void {
  try {
    localStorage.removeItem(PROGRESS_KEY);
  } catch {
    // best-effort
  }
}

function isCell(value: unknown): value is SudokuCell {
  if (!value || typeof value !== "object") return false;
  const cell = value as Record<string, unknown>;
  return (
    Number.isInteger(cell.row) &&
    Number.isInteger(cell.col) &&
    (cell.row as number) >= 0 &&
    (cell.row as number) < 9 &&
    (cell.col as number) >= 0 &&
    (cell.col as number) < 9
  );
}

/** Restore today's saved run, or null if it belongs to another day/corrupt. */
export function loadSudokuProgress(
  seed: string,
  dateIso: string
): SudokuProgress | null {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SudokuProgress>;
    if (parsed.seed !== seed || parsed.dateIso !== dateIso) return null;
    if (!Array.isArray(parsed.log)) return null;
    if (
      typeof parsed.elapsedMs !== "number" ||
      !Number.isFinite(parsed.elapsedMs) ||
      parsed.elapsedMs < 0
    ) {
      return null;
    }

    const log: GameInput[] = parsed.log
      .filter(
        (input): input is GameInput =>
          !!input &&
          typeof input === "object" &&
          typeof (input as GameInput).t === "number" &&
          Number.isFinite((input as GameInput).t) &&
          typeof (input as GameInput).a === "string"
      )
      .map((input) => ({ t: Math.max(0, input.t), a: input.a }))
      .sort((a, b) => a.t - b.t);

    const notes: StoredNotes = Array.isArray(parsed.notes)
      ? (parsed.notes as StoredNotes)
      : [];

    return {
      seed,
      dateIso,
      log,
      elapsedMs: parsed.elapsedMs,
      notes,
      selected: isCell(parsed.selected) ? parsed.selected : null,
      noteMode: Boolean(parsed.noteMode),
    };
  } catch {
    return null;
  }
}
