import React from "react";
import { Box, ButtonBase } from "@mui/material";
import { SUDOKU_SIZE } from "./engine";

export interface SudokuCell {
  row: number;
  col: number;
}

export interface SudokuGridProps {
  board: number[][];
  givens: number[][];
  selected?: SudokuCell | null;
  wrongCell?: SudokuCell | null;
  onSelect?: (row: number, col: number) => void;
  disabled?: boolean;
}

/** Shared 9x9 renderer used by both live play and replay. */
export default function SudokuGrid({
  board,
  givens,
  selected,
  wrongCell,
  onSelect,
  disabled = false,
}: SudokuGridProps) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: `repeat(${SUDOKU_SIZE}, 1fr)`,
        width: "min(92vw, 380px)",
        aspectRatio: "1 / 1",
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
        const isWrong = wrongCell?.row === row && wrongCell?.col === col;

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
              bgcolor: isWrong
                ? "error.main"
                : isSelected
                ? "action.selected"
                : given
                ? "action.hover"
                : "background.paper",
              color: isWrong
                ? "error.contrastText"
                : given
                ? "text.primary"
                : "primary.main",
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
            {value || ""}
          </ButtonBase>
        );
      })}
    </Box>
  );
}
