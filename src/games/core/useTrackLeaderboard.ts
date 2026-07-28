import { useEffect, useMemo, useRef, useState } from "react";
import { dataLayer } from "@formstr/local-relay";
import { DeterministicGame, GameInput } from "./types";
import { verifyReplay } from "./replayEngine";
import { KIND_GAME_SCORE, getTrackSeed, parseScoreEvent, trackScoreDTag } from "./scoreEvents";

export interface LeaderboardEntry {
  pubkey: string;
  score: number;
  /** true iff the seed matches the expected track seed AND replaying the
   *  published inputLog against it independently reproduces the claimed score. */
  verified: boolean;
  createdAt: number;
  /** carried along so a leaderboard row can be handed straight to a Replay
   *  component without a second fetch. */
  seed: string;
  inputLog: GameInput[];
}

/**
 * Same self-verifying leaderboard as useDailyLeaderboard, but for a fixed
 * per-track seed instead of a daily-rotating seed. Used by hand-curated tracks
 * where the leaderboard is permanent/all-time for that track.
 */
export function useTrackLeaderboard<TAction extends string = string>(
  gameId: string,
  trackId: string,
  gameFactory: () => DeterministicGame<TAction>
): LeaderboardEntry[] {
  const [entries, setEntries] = useState<Map<string, LeaderboardEntry>>(new Map());
  const gameFactoryRef = useRef(gameFactory);
  gameFactoryRef.current = gameFactory;

  useEffect(() => {
    setEntries(new Map());
    if (!trackId) return; // not a track leaderboard; skip subscription
    const dTag = trackScoreDTag(gameId, trackId);
    const expectedSeed = getTrackSeed(gameId, trackId);

    const handle = dataLayer.observe(
      [{ kinds: [KIND_GAME_SCORE], "#d": [dTag] }],
      {
        onEvent: (event) => {
          const parsed = parseScoreEvent(event);
          if (!parsed) return;

          let verified = false;
          if (parsed.seed === expectedSeed) {
            try {
              const result = verifyReplay(gameFactoryRef.current, parsed.seed, parsed.inputLog);
              verified = result.score === parsed.score;
            } catch {
              verified = false;
            }
          }

          setEntries((prev) => {
            const existing = prev.get(parsed.pubkey);
            // Racing: keep the fastest verified time per pubkey, not the latest.
            if (existing && existing.verified && existing.score <= parsed.score) return prev;
            const next = new Map(prev);
            next.set(parsed.pubkey, {
              pubkey: parsed.pubkey,
              score: parsed.score,
              verified,
              createdAt: event.created_at,
              seed: parsed.seed,
              inputLog: parsed.inputLog,
            });
            return next;
          });
        },
      },
      {}
    );

    return () => handle.unobserve();
  }, [gameId, trackId]);

  return useMemo(
    () =>
      Array.from(entries.values())
        .filter((e) => e.verified)
        // Racing: score is time in ms, lower is better.
        .sort((a, b) => a.score - b.score),
    [entries]
  );
}
