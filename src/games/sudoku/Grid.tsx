import React from "react";
import { Box, ButtonBase } from "@mui/material";
import { SUDOKU_SIZE } from "./engine";

export interface SudokuCell {
  row: number;
  col: number;
}

/** Key into the pencil-note map. */
export function sudokuNoteKey(row: number, col: number): string {
  return `${row},${col}`;
}

/** Candidate digits currently pencilled into each cell, keyed by
 *  `sudokuNoteKey(row, col)`. Notes are UI-only — they never affect the
 *  puzzle state, score, or replayed input log. */
export type SudokuNotes = Map<string, Set<number>>;

export interface SudokuGridProps {
  board: number[][];
  givens: number[][];
  selected?: SudokuCell | null;
  notes?: SudokuNotes;
  onSelect?: (row: number, col: number) => void;
  disabled?: boolean;
}

/** Shared 9x9 renderer used by both live play and replay. */
export default function SudokuGrid({
  board,
  givens,
  selected,
  notes,
  onSelect,
  disabled = false,
}: SudokuGridProps) {
  return (
    <Box
      data-sudoku-grid
      sx={{
        display: "grid",
        gridTemplateColumns: `repeat(${SUDOKU_SIZE}, 1fr)`,
        gridTemplateRows: `repeat(${SUDOKU_SIZE}, 1fr)`,
        width: "min(92vw, 70vh, 380px)",
        height: "min(92vw, 70vh, 380px)",
        flexShrink: 0,
        border: "2px solid",
        borderColor: "text.primary",
        borderRadius: 1.5,
        overflow: "hidden",
        bgcolor: "background.paper",
        userSelect: "none",
      }}
    >
      {Array.from({ length: SUDOKU_SIZE * SUDOKU_SIZE }, (_, index) => {
        const row = Math.floor(index / SUDOKU_SIZE);
        const col = index % SUDOKU_SIZE;
        const value = board[row]?.[col] ?? 0;
        const given = (givens[row]?.[col] ?? 0) !== 0;
        const isSelected = selected?.row === row && selected?.col === col;
        const cellNotes = notes?.get(sudokuNoteKey(row, col));

        return (
          <ButtonBase
            key={index}
            onClick={() => {
              if (!given) onSelect?.(row, col);
            }}
            disabled={given || disabled}
            aria-label={`Row ${row + 1}, column ${col + 1}${given ? ", given" : ""}`}
            sx={{
              position: "relative",
              width: "100%",
              height: "100%",
              minWidth: 0,
              minHeight: 0,
              borderRadius: 0,
              borderRight: col < SUDOKU_SIZE - 1 ? "1px solid" : 0,
              borderBottom: row < SUDOKU_SIZE - 1 ? "1px solid" : 0,
              borderColor: "divider",
              ...(col % 3 === 2 && col < SUDOKU_SIZE - 1
                ? { borderRightWidth: 2, borderRightColor: "text.secondary" }
                : {}),
              ...(row % 3 === 2 && row < SUDOKU_SIZE - 1
                ? { borderBottomWidth: 2, borderBottomColor: "text.secondary" }
                : {}),
              bgcolor: isSelected
                ? "action.selected"
                : given
                ? "action.hover"
                : "background.paper",
              color: given ? "text.primary" : "primary.main",
              fontWeight: given ? 700 : 500,
              fontSize: { xs: 18, sm: 21 },
              lineHeight: 1,
              transition: "background-color 120ms ease-out",
              "&.Mui-disabled": {
                color: given ? "text.primary" : "primary.main",
                opacity: 1,
              },
              ...(isSelected ? { boxShadow: "inset 0 0 0 2px", color: "primary.main" } : {}),
            }}
          >
            {value ? (
              value
            ) : cellNotes && cellNotes.size > 0 ? (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  width: "100%",
                  height: "100%",
                  p: "2px",
                }}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                  <Box
                    key={digit}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: { xs: 7, sm: 8 },
                      lineHeight: 1,
                      color: "text.secondary",
                    }}
                  >
                    {cellNotes.has(digit) ? digit : ""}
                  </Box>
                ))}
              </Box>
            ) : null}
          </ButtonBase>
        );
      })}
    </Box>
  );
}
