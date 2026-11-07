import type { Event } from "@formstr/local-relay";
import { collectOnce } from "../../../dataLayer/collect";
import { encodeInputLog } from "../../core/inputLogCodec";
import { getDailySeed, parseScoreEvent } from "../../core/scoreEvents";
import type { GameInput } from "../../core/types";
import { getSudokuPuzzle } from "../engine";
import {
  SUDOKU_GAME_ID,
  getEventStreak,
  verifySudokuStreak,
} from "../streak";

jest.mock("../../../dataLayer/collect", () => ({
  collectOnce: jest.fn(),
}));

const mockedCollectOnce = collectOnce as jest.MockedFunction<typeof collectOnce>;

function solvingLog(seed: string): GameInput[] {
  const { puzzle, solution } = getSudokuPuzzle(seed);
  const log: GameInput[] = [];
  let t = 0;
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (puzzle[row][col] !== 0) continue;
      t += 100;
      log.push({ t, a: `${row},${col},${solution[row][col]}` });
    }
  }
  t += 100;
  log.push({ t, a: "submit" });
  return log;
}

function makeEvent(
  id: string,
  dateIso: string,
  streak: number,
  options?: { missingStreakTag?: boolean; wrongLogSeed?: string }
): Event {
  const seed = getDailySeed(SUDOKU_GAME_ID, dateIso);
  const tags = [
    ["d", `${SUDOKU_GAME_ID}:${dateIso}`],
    ["seed", seed],
    ["score", String(streak)],
    ["game_version", "1.0.0"],
  ];
  if (!options?.missingStreakTag) tags.push(["streak", String(streak)]);
  return {
    id,
    pubkey: "a".repeat(64),
    created_at: 1,
    kind: 33404,
    tags,
    content: JSON.stringify(encodeInputLog(solvingLog(options?.wrongLogSeed ?? seed))),
    sig: "0".repeat(128),
  } as Event;
}

async function verify(event: Event, dateIso: string): Promise<boolean> {
  const parsed = parseScoreEvent(event);
  if (!parsed) throw new Error("bad test event");
  return verifySudokuStreak({
    event,
    parsed,
    expectedSeed: getDailySeed(SUDOKU_GAME_ID, dateIso),
    gameId: SUDOKU_GAME_ID,
    dateIso,
  });
}

describe("Sudoku streak verification", () => {
  const today = "2026-07-17";
  const yesterday = "2026-07-16";
  const twoDaysAgo = "2026-07-15";

  beforeEach(() => {
    mockedCollectOnce.mockReset();
  });

  test("accepts a contiguous 3-day chain of solved puzzles", async () => {
    const todayEvent = makeEvent("today", today, 3);
    mockedCollectOnce.mockResolvedValue([
      makeEvent("yesterday", yesterday, 2),
      makeEvent("two-days-ago", twoDaysAgo, 1),
    ]);

    await expect(verify(todayEvent, today)).resolves.toBe(true);
  });

  test("rejects a gap or a streak that doesn't count down", async () => {
    const todayEvent = makeEvent("today-gap", today, 3);
    mockedCollectOnce.mockResolvedValue([
      makeEvent("yesterday-gap", yesterday, 2),
      makeEvent("two-days-ago-wrong", twoDaysAgo, 2),
    ]);
    await expect(verify(todayEvent, today)).resolves.toBe(false);

    mockedCollectOnce.mockResolvedValue([makeEvent("yesterday-only", yesterday, 2)]);
    await expect(
      verify(makeEvent("today-missing", today, 3), today)
    ).resolves.toBe(false);
  });

  test("rejects a chain member whose input log doesn't solve its day", async () => {
    const todayEvent = makeEvent("today-wrong-log", today, 2);
    mockedCollectOnce.mockResolvedValue([
      makeEvent("yesterday-wrong-log", yesterday, 1, {
        wrongLogSeed: getDailySeed(SUDOKU_GAME_ID, twoDaysAgo),
      }),
    ]);
    await expect(verify(todayEvent, today)).resolves.toBe(false);
  });

  test("ignores pre-streak timed-score events", async () => {
    const oldEvent = makeEvent("old", today, 9000, { missingStreakTag: true });
    expect(getEventStreak(oldEvent)).toBeNull();
    await expect(verify(oldEvent, today)).resolves.toBe(false);
  });

  test("requires score and streak tags to agree", async () => {
    const event = makeEvent("mismatch", today, 3);
    event.tags = event.tags.map((tag) =>
      tag[0] === "streak" ? ["streak", "4"] : tag
    );
    await expect(verify(event, today)).resolves.toBe(false);
  });
});
