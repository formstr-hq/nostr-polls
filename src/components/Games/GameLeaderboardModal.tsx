import React, { useState } from "react";
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
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
import { useAllTimeLeaderboard } from "../../games/core/allTimeLeaderboard";

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
  const [tab, setTab] = useState(0);
  const daily = useDailyLeaderboard(gameId, dateIso, gameFactory, verifyEntry);
  const allTime = useAllTimeLeaderboard(
    gameId,
    open && tab === 0,
    gameFactory,
    verifyEntry
  );
  const [replayEntry, setReplayEntry] = useState<LeaderboardEntry | null>(null);

  const showingAllTime = tab === 0;
  const entries = showingAllTime ? allTime.entries : daily;

  const content = (
    <>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 2, py: 1.5 }}>
        <Typography variant="h6">{label} leaderboard</Typography>
        <IconButton size="small" onClick={onClose} aria-label="Close leaderboard">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={{ mx: 2, mb: 1, p: 0.5, borderRadius: "14px", bgcolor: "action.hover" }}>
        <Tabs
          value={tab}
          onChange={(_, value) => setTab(value)}
          variant="fullWidth"
          aria-label="Leaderboard range"
          TabIndicatorProps={{ sx: { display: "none" } }}
          sx={{
            minHeight: 34,
            "& .MuiTab-root": {
              minHeight: 34,
              borderRadius: "11px",
              fontWeight: 700,
              fontSize: 13,
              color: "text.secondary",
            },
            "& .MuiTab-root.Mui-selected": {
              bgcolor: "text.primary",
              color: "background.default",
            },
          }}
        >
          <Tab label="All-time" />
          <Tab label="Today" />
        </Tabs>
      </Box>

      <Box
        sx={{
          overflowY: "auto",
          maxHeight: isMobile ? "60vh" : "calc(100vh - 180px)",
        }}
      >
        <LeaderboardPanel
          entries={entries}
          onReplay={setReplayEntry}
          scoreSuffix={scoreSuffix}
          showDate={showingAllTime}
          loading={showingAllTime && allTime.loading}
          emptyMessage={
            showingAllTime
              ? "No verified scores yet — be the first."
              : "No verified scores yet today — be the first."
          }
        />
      </Box>
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
          {replayEntry?.dateIso ? ` — ${replayEntry.dateIso}` : ""}
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
