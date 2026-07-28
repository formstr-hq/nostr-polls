import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LeaderboardEntry } from "../../core/useTrackLeaderboard";
import { Racer3DAction, Racer3DEngine } from "../engine/racer3dEngine";
import { TrackData } from "../engine/track";
import { FIXED_STEP_MS } from "../../core/types";
import { verifyReplay } from "../../core/replayEngine";

export interface Ghost {
  pubkey: string;
  score: number;
  engine: Racer3DEngine;
  color: string;
}

const GHOST_COLORS = ["#1976d2", "#388e3c", "#f57c00", "#7b1fa2", "#00796b"];

interface GhostRuntime {
  ghost: Ghost;
  inputLog: { t: number; a: Racer3DAction }[];
  nextInput: number;
  clock: number;
  verified: boolean;
}

/**
 * Spawns verified replay engines for the top leaderboard entries and keeps
 * them tick-locked to the live player's elapsed time. Each ghost replays its
 * published input log incrementally using the exact same rule as
 * verifyReplay: apply pending inputs with t < clock+FIXED_STEP_MS, then tick.
 */
export function useGhostReplays(
  track: TrackData,
  entries: LeaderboardEntry[],
  elapsedMs: number,
  enabled: boolean,
  maxGhosts = 3
): Ghost[] {
  const [ghosts, setGhosts] = useState<GhostRuntime[]>([]);
  const elapsedRef = useRef(elapsedMs);
  elapsedRef.current = elapsedMs;

  useEffect(() => {
    if (!enabled) {
      setGhosts([]);
      return;
    }

    const chosen = entries
      .filter((e) => {
        // Defensive: verify each entry ourselves before spawning.
        if (e.seed !== track.seed) {
          console.warn("[racer3d ghost] seed mismatch, skipping", e.pubkey, e.score);
          return false;
        }
        try {
          const factory = () => {
            const eng = new Racer3DEngine();
            eng.setTrack(track);
            return eng;
          };
          const result = verifyReplay(factory, e.seed, e.inputLog);
          if (result.score !== e.score) {
            console.warn("[racer3d ghost] replay score mismatch, skipping", e.pubkey, e.score, result.score);
            return false;
          }
          return true;
        } catch (err) {
          console.warn("[racer3d ghost] replay failed, skipping", e.pubkey, e.score, err);
          return false;
        }
      })
      .slice(0, maxGhosts);

    console.log("[racer3d ghost] spawning", chosen.length, "ghosts from", entries.length, "entries");

    const newGhosts: GhostRuntime[] = chosen.map((entry, i) => {
      const engine = new Racer3DEngine();
      engine.setTrack(track);
      engine.init(track.seed);
      return {
        ghost: {
          pubkey: entry.pubkey,
          score: entry.score,
          engine,
          color: GHOST_COLORS[i % GHOST_COLORS.length],
        },
        inputLog: [...entry.inputLog]
          .sort((a, b) => a.t - b.t)
          .map(({ t, a }) => ({ t, a: a as Racer3DAction })),
        nextInput: 0,
        clock: 0,
        verified: true,
      };
    });

    setGhosts(newGhosts);
  }, [track, entries, enabled, maxGhosts]);

  // Drive ghosts forward every frame to match the live player's elapsed time.
  useLayoutEffect(() => {
    let raf = 0;
    const loop = () => {
      const liveClock = Math.floor(elapsedRef.current / FIXED_STEP_MS) * FIXED_STEP_MS;
      for (const g of ghosts) {
        if (g.ghost.engine.isGameOver()) continue;
        while (g.clock < liveClock) {
          // Apply all inputs whose timestamp falls before the upcoming tick
          // boundary — this matches verifyReplay's rule exactly.
          const upcoming = g.clock + FIXED_STEP_MS;
          while (
            g.nextInput < g.inputLog.length &&
            g.inputLog[g.nextInput].t < upcoming
          ) {
            const { t, a } = g.inputLog[g.nextInput];
            g.ghost.engine.applyInput(a, t);
            g.nextInput++;
          }
          g.ghost.engine.tick(FIXED_STEP_MS);
          g.clock += FIXED_STEP_MS;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ghosts]);

  return ghosts.map((g) => g.ghost);
}
