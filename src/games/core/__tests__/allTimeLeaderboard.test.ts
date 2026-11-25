import {
  buildAllTimeFilters,
  dateIsoFromEvent,
  datesBetween,
} from "../allTimeLeaderboard";
import type { Event } from "@formstr/local-relay";

function scoreEvent(dTag: string): Event {
  return {
    id: "a".repeat(64),
    pubkey: "b".repeat(64),
    kind: 33404,
    created_at: 1_700_000_000,
    content: "{}",
    tags: [["d", dTag]],
    sig: "c".repeat(128),
  };
}

describe("all-time leaderboard helpers", () => {
  it("enumerates inclusive UTC dates", () => {
    expect(datesBetween("2026-07-01", "2026-07-03")).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
    expect(datesBetween("2026-07-03", "2026-07-01")).toEqual([]);
  });

  it("chunks exact d-tag values into filters", () => {
    const filters = buildAllTimeFilters("2048", "2026-07-01", "2026-07-03");
    expect(filters).toHaveLength(1);
    expect(filters[0].kinds).toEqual([33404]);
    expect(filters[0]["#d"]).toEqual([
      "2048:2026-07-01",
      "2048:2026-07-02",
      "2048:2026-07-03",
    ]);
  });

  it("splits long ranges at the 50-value relay chunk size", () => {
    const filters = buildAllTimeFilters("tetris", "2026-07-01", "2026-09-30");
    expect(filters.length).toBeGreaterThan(1);
    expect(filters[0]["#d"]).toHaveLength(50);
    expect(filters.every((filter) => (filter["#d"] || []).length <= 50)).toBe(
      true
    );
  });

  it("reads the date from the game-scoped d tag", () => {
    expect(dateIsoFromEvent(scoreEvent("2048:2026-07-17"), "2048")).toBe(
      "2026-07-17"
    );
    expect(dateIsoFromEvent(scoreEvent("tetris:2026-07-17"), "2048")).toBeNull();
    expect(dateIsoFromEvent(scoreEvent("2048:not-a-date"), "2048")).toBeNull();
  });
});
