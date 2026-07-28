import React, { useMemo } from "react";
import { TrackSpline } from "../engine/track";
import { Racer3DState } from "../engine/racer3dEngine";
import { Ghost } from "../hooks/useGhostReplays";

interface MinimapProps {
  spline: TrackSpline;
  playerState: Racer3DState;
  ghosts: Ghost[];
  size?: number;
}

/**
 * Simple top-down minimap: track spline as a thin line, player as a red dot,
 * ghosts as colored dots. Always shows the full track so you can see where
 * everyone is regardless of camera angle or fog.
 */
export default function Minimap({ spline, playerState, ghosts, size = 160 }: MinimapProps) {
  const pad = 10;
  const viewSize = size + pad * 2;

  const { path, mapWorldToSvg } = useMemo(() => {
    const N = 120;
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    const raw: { x: number; z: number }[] = [];
    for (let i = 0; i <= N; i++) {
      const p = spline.positionAt((i / N) * spline.length);
      raw.push(p);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const rangeX = Math.max(maxX - minX, 1);
    const rangeZ = Math.max(maxZ - minZ, 1);
    const scale = Math.min(size / rangeX, size / rangeZ);
    const offX = (size - rangeX * scale) / 2;
    const offY = (size - rangeZ * scale) / 2;

    const toSvg = (p: { x: number; z: number }) => ({
      x: pad + offX + (p.x - minX) * scale,
      y: pad + offY + (p.z - minZ) * scale,
    });

    let d = "";
    raw.forEach((p, i) => {
      const { x, y } = toSvg(p);
      d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });

    return {
      path: d,
      mapWorldToSvg: (x: number, z: number) => toSvg({ x, z }),
    };
  }, [spline, size, pad]);

  const playerPos = mapWorldToSvg(playerState.car.x, playerState.car.z);
  const startPos = mapWorldToSvg(spline.positionAt(0).x, spline.positionAt(0).z);

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        width: viewSize,
        height: viewSize,
        background: "rgba(0,0,0,0.5)",
        borderRadius: 12,
        backdropFilter: "blur(3px)",
        pointerEvents: "none",
      }}
    >
      <svg width={viewSize} height={viewSize}>
        <path d={path} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={2} />
        {/* Start/finish flag */}
        <g>
          <line x1={startPos.x} y1={startPos.y - 6} x2={startPos.x} y2={startPos.y + 6} stroke="#fff" strokeWidth={2} />
          <path
            d={`M ${startPos.x} ${startPos.y - 6} L ${startPos.x + 10} ${startPos.y - 3} L ${startPos.x} ${startPos.y} Z`}
            fill="#4ade80"
          />
        </g>
        {ghosts.map((g) => {
          const s = g.engine.getState().car;
          const p = mapWorldToSvg(s.x, s.z);
          return (
            <circle
              key={g.pubkey}
              cx={p.x}
              cy={p.y}
              r={4}
              fill={g.color}
              stroke="#fff"
              strokeWidth={1}
            />
          );
        })}
        <circle cx={playerPos.x} cy={playerPos.y} r={5} fill="#e53935" stroke="#fff" strokeWidth={2} />
      </svg>
    </div>
  );
}
