import { useEffect, useRef, useState } from "react";
import type { Event, Filter } from "@formstr/local-relay";
import { collectOnce } from "../../dataLayer/collect";
import { DeterministicGame } from "./types";
import { verifyReplay } from "./replayEngine";
import {
  KIND_GAME_SCORE,
  StoredScore,
  getDailySeed,
  parseScoreEvent,
  scoreDTag,
  todayUtcIso,
} from "./scoreEvents";
import { LeaderboardEntry, LeaderboardVerifier } from "./useDailyLeaderboard";

/** Games shipped in July 2026; enumerating from here covers every score. */
export const GAME_SCORE_EPOCH = "2026-07-01";

const DATE_CHUNK = 50;
const MAX_ATTEMPTS = 120;
const MAX_ENTRIES = 50;

/** Every UTC calendar day from `startIso` to `endIso`, inclusive. */
export function datesBetween(startIso: string, endIso: string): string[] {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];

  const dates: string[] = [];
  for (let time = start; time <= end; time += 86_400_000) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }
  return dates;
}

/** The `d` tag a score event must carry, or null for another game / bad date. */
export function dateIsoFromEvent(event: Event, gameId: string): string | null {
  const dTag = event.tags.find((tag) => tag[0] === "d")?.[1];
  const prefix = `${gameId}:`;
  if (!dTag || !dTag.startsWith(prefix)) return null;
  const dateIso = dTag.slice(prefix.length);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? dateIso : null;
}

/**
 * All-time reads cannot use a `#d` prefix filter (NIP-01 matches exact values),
 * so enumerate every day and chunk the exact `gameId:date` values.
 */
export function buildAllTimeFilters(
  gameId: string,
  fromIso: string = GAME_SCORE_EPOCH,
  toIso: string = todayUtcIso()
): Filter[] {
  const dTags = datesBetween(fromIso, toIso).map((date) => scoreDTag(gameId, date));
  const filters: Filter[] = [];
  for (let index = 0; index < dTags.length; index += DATE_CHUNK) {
    filters.push({
      kinds: [KIND_GAME_SCORE],
      "#d": dTags.slice(index, index + DATE_CHUNK),
    });
  }
  return filters;
}

interface Claim {
  event: Event;
  parsed: StoredScore;
  dateIso: string;
}

const verifiedByEventId = new Map<string, boolean>();

/**
 * Best single verified result per player across every day. Replays are cached
 * per event so opening the all-time tab again (or switching tabs) is cheap.
 */
export function useAllTimeLeaderboard<TAction extends string = string>(
  gameId: string,
  enabled: boolean,
  gameFactory: () => DeterministicGame<TAction>,
  verifyEntry?: LeaderboardVerifier
): { entries: LeaderboardEntry[]; loading: boolean } {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const gameFactoryRef = useRef(gameFactory);
  gameFactoryRef.current = gameFactory;
  const verifierRef = useRef(verifyEntry);
  verifierRef.current = verifyEntry;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    setLoading(true);
    const load = async () => {
      const events = await collectOnce(buildAllTimeFilters(gameId), {
        timeoutMs: 10_000,
        quietMs: 900,
      });
      if (cancelled) return;

      // Group every published claim by player. A player's daily events are
      // independently verified later; pre-sorting by score means a cheater's
      // top claim cannot hide the next legitimate result.
      const byPlayer = new Map<string, Claim[]>();
      for (const event of events) {
        const parsed = parseScoreEvent(event);
        if (!parsed) continue;
        const dateIso = dateIsoFromEvent(event, gameId);
        if (!dateIso) continue;
        // Cheap prefilter: a score for the wrong day's seed is never valid.
        if (parsed.seed !== getDailySeed(gameId, dateIso)) continue;

        const list = byPlayer.get(parsed.pubkey) || [];
        list.push({ event, parsed, dateIso });
        byPlayer.set(parsed.pubkey, list);
      }

      const maxAttempts = verifierRef.current ? 60 : MAX_ATTEMPTS;
      const claims = Array.from(byPlayer.values())
        .flat()
        .sort(
          (a, b) =>
            b.parsed.score - a.parsed.score ||
            a.event.created_at - b.event.created_at
        )
        .slice(0, maxAttempts);

      const verified: LeaderboardEntry[] = [];
      const resolved = new Set<string>();

      for (const claim of claims) {
        if (cancelled || verified.length >= MAX_ENTRIES) break;
        if (resolved.has(claim.parsed.pubkey)) continue;

        const { event, parsed, dateIso } = claim;
        let ok = verifiedByEventId.get(event.id);
        if (ok === undefined) {
          ok = false;
          try {
            if (verifierRef.current) {
              ok = await verifierRef.current({
                event,
                parsed,
                expectedSeed: getDailySeed(gameId, dateIso),
                gameId,
                dateIso,
              });
            } else {
              ok =
                verifyReplay(gameFactoryRef.current, parsed.seed, parsed.inputLog)
                  .score === parsed.score;
            }
          } catch {
            ok = false;
          }
          verifiedByEventId.set(event.id, ok);
        }

        if (!ok) continue;
        resolved.add(parsed.pubkey);
        verified.push({
          pubkey: parsed.pubkey,
          score: parsed.score,
          verified: true,
          createdAt: event.created_at,
          seed: parsed.seed,
          inputLog: parsed.inputLog,
          dateIso,
        });

        // Let the dialog paint between CPU-heavy replays.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      if (cancelled) return;
      setEntries(
        verified
          .sort(
            (a, b) =>
              b.score - a.score || a.createdAt - b.createdAt
          )
          .slice(0, MAX_ENTRIES)
      );
      setLoading(false);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [gameId, enabled]);

  return { entries, loading };
}
