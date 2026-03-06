import React, { useState } from "react";
import {
  Box,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
} from "@mui/material";
import CellTowerIcon from "@mui/icons-material/CellTower";
import { Event } from "nostr-tools";
import { useRelays } from "../../../hooks/useRelays";
import { waitForPublish } from "../../../utils/publish";

type BroadcastState = "idle" | "broadcasting" | "done";

export const BroadcastButton: React.FC<{ event: Event }> = ({ event }) => {
  const { relays } = useRelays();
  const [state, setState] = useState<BroadcastState>("idle");
  const [result, setResult] = useState<{ accepted: number; total: number } | null>(null);

  const handleBroadcast = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (state === "broadcasting") return;
    setState("broadcasting");
    try {
      const res = await waitForPublish(relays, event);
      setResult({ accepted: res.accepted, total: res.total });
    } catch {
      setResult({ accepted: 0, total: relays.length });
    } finally {
      setState("done");
    }
  };

  const tooltipTitle =
    state === "done" && result
      ? `Broadcast complete — accepted by ${result.accepted} of ${result.total} relays`
      : "Broadcast to your relays";

  const success = result && result.accepted > 0;

  return (
    <Tooltip title={tooltipTitle} placement="top">
      <Box
        display="flex"
        alignItems="center"
        sx={{ cursor: state === "broadcasting" ? "default" : "pointer" }}
        onClick={handleBroadcast}
      >
        <IconButton size="small" sx={{ p: 0.25, padding: 2 }}>
          {state === "broadcasting" ? (
            <CircularProgress size={18} />
          ) : (
            <CellTowerIcon
              sx={{
                fontSize: "22px !important",
                ...(state === "done" && {
                  color: success ? "success.main" : "error.main",
                }),
              }}
            />
          )}
        </IconButton>

        {state === "done" && result !== null && (
          <Typography
            variant="caption"
            sx={{
              fontWeight: 500,
              fontSize: "0.7rem",
              color: success ? "success.main" : "error.main",
            }}
          >
            {result.accepted}/{result.total}
          </Typography>
        )}
      </Box>
    </Tooltip>
  );
};
