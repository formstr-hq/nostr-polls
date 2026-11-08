import { GameInput } from "./types";

/**
 * Records player inputs with timestamps relative to session start. The
 * resulting log IS the replay — publishing it alongside the seed is what
 * lets any other client independently recompute the score.
 */
export class InputRecorder {
  private startedAt = performance.now();
  private log: GameInput[] = [];
  private pausedAt: number | null = null;
  private pausedTotal = 0;

  reset() {
    this.startedAt = performance.now();
    this.log = [];
    this.pausedAt = null;
    this.pausedTotal = 0;
  }

  /**
   * Rehydrate a saved session: keep its log, and make `elapsedNow()` continue
   * from the saved game time so newly recorded inputs are timestamped after
   * the restored ones.
   */
  restore(log: GameInput[], elapsedMs: number) {
    this.startedAt = performance.now() - Math.max(0, elapsedMs);
    this.log = log.map((input) => ({ ...input }));
    this.pausedAt = null;
    this.pausedTotal = 0;
  }

  record(action: string) {
    this.log.push({ t: Math.round(this.elapsedNow()), a: action });
  }

  getLog(): GameInput[] {
    return this.log;
  }

  /** Freeze session time. While paused, `elapsedNow` stops advancing so the
   *  live tick loop (gravity/motion) halts and no wall-clock gap leaks into
   *  input timestamps — replay stays identical to live play. Idempotent. */
  pause() {
    if (this.pausedAt === null) this.pausedAt = performance.now();
  }

  /** Resume session time, folding the elapsed pause into `pausedTotal` so
   *  post-resume timestamps continue seamlessly from where they left off. */
  resume() {
    if (this.pausedAt !== null) {
      this.pausedTotal += performance.now() - this.pausedAt;
      this.pausedAt = null;
    }
  }

  isPaused(): boolean {
    return this.pausedAt !== null;
  }

  /** Elapsed ms of un-paused session time, on the same clock `record`
   *  timestamps use — so a live tick loop can advance in lockstep with
   *  recorded inputs. Held frozen at the pause instant while paused. */
  elapsedNow(): number {
    const ref = this.pausedAt ?? performance.now();
    return ref - this.startedAt - this.pausedTotal;
  }
}
