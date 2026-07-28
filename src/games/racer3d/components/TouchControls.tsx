import React from "react";
import { Button } from "@mui/material";
import { Racer3DAction } from "../engine/racer3dEngine";

export default function TouchControls({ sendAction }: { sendAction: (a: Racer3DAction) => void }) {
  const steerButton = (
    actionDown: Racer3DAction,
    actionUp: Racer3DAction,
    label: string,
    flex: number = 1
  ) => (
    <Button
      variant="contained"
      size="large"
      sx={{
        flex,
        minHeight: 72,
        fontSize: 24,
        fontWeight: 700,
        bgcolor: "rgba(255,255,255,0.15)",
        color: "#fff",
        border: "1px solid rgba(255,255,255,0.3)",
        userSelect: "none",
        touchAction: "none",
        "&:active": { bgcolor: "rgba(255,255,255,0.35)" },
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        sendAction(actionDown);
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        sendAction(actionUp);
      }}
      onPointerLeave={(e) => {
        e.preventDefault();
        sendAction(actionUp);
      }}
      onPointerCancel={(e) => {
        e.preventDefault();
        sendAction(actionUp);
      }}
    >
      {label}
    </Button>
  );

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        padding: 12,
        gap: 12,
        pointerEvents: "none",
      }}
    >
      <div style={{ display: "flex", gap: 8, flex: 1, pointerEvents: "auto" }}>
        {steerButton("left_down", "left_up", "◀", 1)}
        {steerButton("right_down", "right_up", "▶", 1)}
      </div>
      <div style={{ display: "flex", gap: 8, flex: 1, justifyContent: "flex-end", pointerEvents: "auto" }}>
        {steerButton("brake_down", "brake_up", "B", 0.7)}
        {steerButton("accel_down", "accel_up", "A", 1)}
      </div>
    </div>
  );
}
