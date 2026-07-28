import { verifyReplay } from "../../core/replayEngine";
import { GameInput } from "../../core/types";
import { Racer3DAction, Racer3DEngine } from "../engine/racer3dEngine";
import { buildTrack, TRACK_1 } from "../engine/track";

const track = buildTrack(TRACK_1);

function factory() {
  const e = new Racer3DEngine();
  e.setTrack(track);
  return e;
}

describe("Racer3DEngine determinism", () => {
  it("live play matches verifyReplay for a scripted input sequence", () => {
    const live = factory();
    live.init(track.seed);

    // Scripted inputs with explicit timestamps (ms from session start).
    const inputs: { t: number; a: Racer3DAction }[] = [
      { t: 0, a: "accel_down" },
      { t: 3000, a: "accel_up" },
      { t: 3500, a: "brake_down" },
      { t: 5000, a: "brake_up" },
      { t: 5200, a: "left_down" },
      { t: 7000, a: "left_up" },
    ];
    const inputLog: GameInput[] = inputs.map(({ t, a }) => ({ t, a }));

    // Apply inputs at their timestamps, ticking in fixed 16ms steps — the
    // same rule verifyReplay uses (ticks = floor(t / FIXED_STEP_MS)).
    let totalTicks = 0;
    for (const { t, a } of inputs) {
      const targetTicks = Math.floor(t / 16);
      while (totalTicks < targetTicks && !live.isGameOver()) {
        live.tick(16);
        totalTicks++;
      }
      live.applyInput(a, t);
    }
    // Trailing ticks — cap so total matches verifyReplay's MAX_TICKS cap.
    const MAX_TICKS = 225_000;
    while (!live.isGameOver() && totalTicks < MAX_TICKS) {
      live.tick(16);
      totalTicks++;
    }

    const liveScore = live.getScore();
    const liveHash = live.getStateHash();

    const result = verifyReplay(factory, track.seed, inputLog);

    expect(result.score).toBe(liveScore);
    expect(result.stateHash).toBe(liveHash);
  });

  it("seed mismatch throws (cherry-picking protection)", () => {
    expect(() =>
      verifyReplay(factory, "0".repeat(64), [
        { t: 0, a: "accel_down" as Racer3DAction },
      ])
    ).toThrow();
  });
});