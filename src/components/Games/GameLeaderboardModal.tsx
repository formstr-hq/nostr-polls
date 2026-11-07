import React, { useState } from "react";
import { Box, Dialog, DialogContent, DialogTitle, Drawer, IconButton, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import CloseIcon from "@mui/icons-material/Close";
import LeaderboardPanel from "./LeaderboardPanel";
import { DeterministicGame, GameInput } from "../../games/core/types";
import {
  LeaderboardEntry,
  LeaderboardVerifier,
  useDailyLeaderboard,
} from "../../games/core/useDailyLeaderboard";

export interface GameLeaderboardModalProps<TAction extends string = string> {
  open: boolean;
  onClose: () => void;
  label: string;
  gameId: string;
  dateIso: string;
  gameFactory: () => DeterministicGame<TAction>;
  ReplayView: React.ComponentType<{ seed: string; inputLog: GameInput[] }>;
  /** Game-specific verification for metrics replay alone can't certify. */
  verifyEntry?: LeaderboardVerifier;
  /** Optional unit appended to each score, e.g. "days" for Sudoku streaks. */
  scoreSuffix?: string;
}

/**
 * Dialog on mobile, side Drawer on desktop — same leaderboard content either
 * way. Always mounted (visibility toggled by `open`) so the leaderboard
 * subscription (`useDailyLeaderboard`) stays warm in the background and opens
 * instantly rather than showing a cold, empty list.
 */
export default function GameLeaderboardModal<TAction extends string = string>({
  open,
  onClose,
  label,
  gameId,
  dateIso,
  gameFactory,
  ReplayView,
  verifyEntry,
  scoreSuffix,
}: GameLeaderboardModalProps<TAction>) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const leaderboard = useDailyLeaderboard(gameId, dateIso, gameFactory, verifyEntry);
  const [replayEntry, setReplayEntry] = useState<LeaderboardEntry | null>(null);

  const content = (
    <>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 2, py: 1.5 }}>
        <Typography variant="h6">{label} leaderboard</Typography>
        <IconButton size="small" onClick={onClose} aria-label="Close leaderboard">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <LeaderboardPanel
        entries={leaderboard}
        onReplay={setReplayEntry}
        scoreSuffix={scoreSuffix}
      />
    </>
  );

  return (
    <>
      {isMobile ? (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
          {content}
        </Dialog>
      ) : (
        <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: 360 } }}>
          {content}
        </Drawer>
      )}

      <Dialog open={replayEntry !== null} onClose={() => setReplayEntry(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {label} replay
          <IconButton size="small" onClick={() => setReplayEntry(null)} aria-label="Close replay">
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {replayEntry && <ReplayView seed={replayEntry.seed} inputLog={replayEntry.inputLog} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
