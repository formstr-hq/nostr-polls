import type { Event } from "@formstr/local-relay";
import { collectOnce } from "../../dataLayer/collect";
import { verifyReplay } from "../core/replayEngine";
import {
  KIND_GAME_SCORE,
  getDailySeed,
  getMyTodayScore,
  parseScoreEvent,
  scoreDTag,
} from "../core/scoreEvents";
import type { LeaderboardVerifier } from "../core/useDailyLeaderboard";
import { SudokuEngine } from "./engine";

export const SUDOKU_GAME_ID = "sudoku";

/** A streak is one solved puzzle per UTC day. Keep the chain walk bounded so
 *  a forged huge score can't trigger an unbounded network/replay loop. */
const MAX_VERIFIED_STREAK = 366;

/** Positive integer streak claimed by an event's `streak` tag, or null for
 *  pre-streak (timed-score) events. */
export function getEventStreak(event: Event): number | null {
  const raw = event.tags.find((tag) => tag[0] === "streak")?.[1];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function hasStreak(event: Event): boolean {
  return getEventStreak(event) !== null;
}

function shiftUtcDate(dateIso: string, deltaDays: number): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

/** Cache per event id: a published day's solve result never changes. */
const solvedCache = new Map<string, boolean>();

/** True iff this event's input log solves the puzzle for its own `d` date. */
function eventSolvesItsDay(event: Event): boolean {
  const cached = solvedCache.get(event.id);
  if (cached !== undefined) return cached;

  let ok = false;
  try {
    if (event.kind !== KIND_GAME_SCORE) {
      solvedCache.set(event.id, false);
      return false;
    }
    const dTag = event.tags.find((tag) => tag[0] === "d")?.[1];
    const parsed = parseScoreEvent(event);
    if (dTag?.startsWith(`${SUDOKU_GAME_ID}:`) && parsed) {
      const dateIso = dTag.slice(SUDOKU_GAME_ID.length + 1);
      if (parsed.seed === getDailySeed(SUDOKU_GAME_ID, dateIso)) {
        ok = verifyReplay(
          () => new SudokuEngine(),
          parsed.seed,
          parsed.inputLog
        ).gameOver;
      }
    }
  } catch {
    ok = false;
  }

  solvedCache.set(event.id, ok);
  return ok;
}

/**
 * Streak to publish for today: one more than yesterday's verified solved
 * streak, or 1 if yesterday has no valid streak-format event. Used both when
 * publishing and by the board to show the streak.
 */
export async function getSudokuStreakForToday(
  pubkey: string,
  dateIso: string
): Promise<number> {
  const yesterday = shiftUtcDate(dateIso, -1);
  const previous = await getMyTodayScore(SUDOKU_GAME_ID, yesterday, pubkey);
  if (!previous) return 1;

  const streak = getEventStreak(previous.event);
  if (streak === null || previous.score !== streak) return 1;
  if (!eventSolvesItsDay(previous.event)) return 1;
  return streak + 1;
}

/**
 * Verified streak leaderboard entry:
 *   1. today's event solves today's puzzle (checked by replay),
 *   2. its `score` equals its positive `streak` tag,
 *   3. each of the previous N−1 UTC days has a solved event whose streak
 *      counts down N−1 … 1.
 *
 * This is one author-scoped query for all the previous days plus one replay
 * per day (cached by event id for the session).
 */
export const verifySudokuStreak: LeaderboardVerifier = async ({
  event,
  parsed,
  expectedSeed,
  dateIso,
}) => {
  if (parsed.seed !== expectedSeed) return false;

  const dTag = event.tags.find((tag) => tag[0] === "d")?.[1];
  if (dTag !== scoreDTag(SUDOKU_GAME_ID, dateIso)) return false;

  const claimed = getEventStreak(event);
  if (claimed === null || claimed !== parsed.score) return false;
  if (claimed > MAX_VERIFIED_STREAK) return false;
  if (!eventSolvesItsDay(event)) return false;
  if (claimed === 1) return true;

  const previousDates = Array.from(
    { length: claimed - 1 },
    (_, index) => shiftUtcDate(dateIso, -(index + 1))
  );
  const previousDTags = previousDates.map((date) =>
    scoreDTag(SUDOKU_GAME_ID, date)
  );
  // Chunk the #d list so a very long streak doesn't build one oversized filter.
  const filters = [];
  for (let index = 0; index < previousDTags.length; index += 50) {
    filters.push({
      kinds: [KIND_GAME_SCORE],
      authors: [event.pubkey],
      "#d": previousDTags.slice(index, index + 50),
    });
  }
  const previousEvents = await collectOnce(filters, {
    timeoutMs: 5000,
    quietMs: 600,
  });

  const byDate = new Map<string, Event>();
  for (const previous of previousEvents) {
    const d = previous.tags.find((tag) => tag[0] === "d")?.[1];
    if (d) byDate.set(d, previous);
  }

  for (let index = 0; index < previousDates.length; index++) {
    const date = previousDates[index];
    const expectedStreak = claimed - 1 - index;
    const previous = byDate.get(scoreDTag(SUDOKU_GAME_ID, date));
    if (!previous || previous.pubkey !== event.pubkey) return false;

    const previousParsed = parseScoreEvent(previous);
    if (!previousParsed) return false;
    if (previousParsed.seed !== getDailySeed(SUDOKU_GAME_ID, date)) return false;
    if (getEventStreak(previous) !== expectedStreak) return false;
    if (previousParsed.score !== expectedStreak) return false;
    if (!eventSolvesItsDay(previous)) return false;
  }

  return true;
};
