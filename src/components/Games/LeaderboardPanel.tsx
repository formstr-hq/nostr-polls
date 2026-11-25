import React, { useEffect } from "react";
import { Avatar, Box, CircularProgress, IconButton, Stack, Typography } from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { useNavigate } from "react-router-dom";
import { nip19 } from "nostr-tools";
import { useAppContext } from "../../hooks/useAppContext";
import { openProfileTab } from "../../nostr";
import { LeaderboardEntry } from "../../games/core/useDailyLeaderboard";

export interface LeaderboardPanelProps {
  entries: LeaderboardEntry[];
  onReplay: (entry: LeaderboardEntry) => void;
  /** Optional unit appended to each score, e.g. "days" for Sudoku streaks. */
  scoreSuffix?: string;
  /** Show the UTC day a result belongs to (all-time view). */
  showDate?: boolean;
  /** All-time history is fetched/verified lazily. */
  loading?: boolean;
  emptyMessage?: string;
}

/** Avatar/name via the same convention as ReviewCard.tsx: `useAppContext`'s
 *  profile cache + throttled fetch, `openProfileTab` for click-to-profile. */
export default function LeaderboardPanel({
  entries,
  onReplay,
  scoreSuffix,
  showDate = false,
  loading = false,
  emptyMessage = "No verified scores yet today — be the first.",
}: LeaderboardPanelProps) {
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const navigate = useNavigate();

  useEffect(() => {
    for (const entry of entries) {
      if (!profiles?.get(entry.pubkey)) fetchUserProfileThrottled(entry.pubkey);
    }
  }, [entries, profiles, fetchUserProfileThrottled]);

  if (loading) {
    return (
      <Stack alignItems="center" spacing={1} sx={{ py: 4 }}>
        <CircularProgress size={22} />
        <Typography variant="body2" color="text.secondary">
          Verifying all-time scores…
        </Typography>
      </Stack>
    );
  }

  if (entries.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        {emptyMessage}
      </Typography>
    );
  }

  return (
    <Stack spacing={0.5} sx={{ py: 1 }}>
      {entries.map((entry, i) => {
        const profile = profiles?.get(entry.pubkey);
        const npub = nip19.npubEncode(entry.pubkey) as `npub1${string}`;
        const displayName = profile?.name || profile?.username || `${npub.slice(0, 12)}…`;

        return (
          <Stack
            key={entry.pubkey}
            direction="row"
            spacing={1.5}
            alignItems="center"
            sx={{ px: 2, py: 0.75, "&:hover": { bgcolor: "action.hover" } }}
          >
            <Typography variant="body2" sx={{ width: 18, color: "text.secondary" }}>
              {i + 1}
            </Typography>
            <Box
              onClick={() => openProfileTab(npub, navigate)}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                flex: 1,
                minWidth: 0,
                cursor: "pointer",
                "&:hover .leaderboard-name": { textDecoration: "underline" },
              }}
            >
              <Avatar src={profile?.picture} alt={displayName} sx={{ width: 28, height: 28 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography className="leaderboard-name" variant="body2" noWrap>
                  {displayName}
                </Typography>
                {showDate && entry.dateIso && (
                  <Typography variant="caption" color="text.secondary" component="div" noWrap>
                    {entry.dateIso}
                  </Typography>
                )}
              </Box>
            </Box>
            <Typography variant="body2" fontWeight={600}>
              {entry.score}
              {scoreSuffix ? ` ${scoreSuffix}` : ""}
            </Typography>
            <IconButton size="small" onClick={() => onReplay(entry)} aria-label="Watch replay">
              <PlayArrowIcon fontSize="small" />
            </IconButton>
          </Stack>
        );
      })}
    </Stack>
  );
}
