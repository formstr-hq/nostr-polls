import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/**
 * Catmull-Rom spline interpolation between control points. Returns position
 * at parameter `t` (0..1 across the whole loop). The spline is closed
 * (periodic), so the track loops seamlessly — required for lap-based racing
 * and for the start/finish line to align exactly on every lap.
 *
 * Uses the centripetal (uniform-alpha) variant with alpha=0.5 because it
 * avoids the cusps and loops that the uniform variant produces when control
 * points are unevenly spaced, keeping the road ribbon within the author's
 * intent. The interpolation is pure arithmetic on the control points — no
 * platform-dependent ops — so the result is bit-identical across devices.
 */
export class TrackSpline {
  private readonly pts: ReadonlyArray<{ x: number; z: number }>;
  private readonly segCount: number;
  private readonly totalLength: number;
  private readonly cumLengths: number[];

  constructor(points: { x: number; z: number }[]) {
    if (points.length < 4) throw new Error("track needs >= 4 control points");
    this.pts = points;
    this.segCount = points.length;
    this.cumLengths = [0];
    let total = 0;
    for (let i = 0; i < this.segCount; i++) {
      const a = points[i];
      const b = points[(i + 1) % this.segCount];
      total += Math.hypot(b.x - a.x, b.z - a.z);
      this.cumLengths.push(total);
    }
    this.totalLength = total;
  }

  get length(): number {
    return this.totalLength;
  }

  /** Convert a distance-along-track to a (x,z) world position via Catmull-Rom. */
  positionAt(dist: number): { x: number; z: number } {
    const d = ((dist % this.totalLength) + this.totalLength) % this.totalLength;
    let seg = 0;
    for (let i = 0; i < this.segCount; i++) {
      if (d >= this.cumLengths[i] && d < this.cumLengths[i + 1]) {
        seg = i;
        break;
      }
    }
    const segStart = this.cumLengths[seg];
    const segEnd = this.cumLengths[seg + 1];
    const segLen = segEnd - segStart;
    const u = segLen > 0 ? (d - segStart) / segLen : 0;

    const p0 = this.pts[(seg - 1 + this.segCount) % this.segCount];
    const p1 = this.pts[seg];
    const p2 = this.pts[(seg + 1) % this.segCount];
    const p3 = this.pts[(seg + 2) % this.segCount];

    return catmullRom(p0, p1, p2, p3, u);
  }

  /** Forward direction (unit tangent) at a distance along the track. */
  tangentAt(dist: number): { x: number; z: number } {
    const eps = 0.5;
    const a = this.positionAt(dist - eps);
    const b = this.positionAt(dist + eps);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  }

  /** Yaw angle (radians) of the forward tangent at `dist`, for car heading. */
  headingAt(dist: number): number {
    const t = this.tangentAt(dist);
    return Math.atan2(t.x, t.z);
  }
}

/** Centripetal Catmull-Rom with alpha = 0.5, the standard racing-game choice. */
function catmullRom(
  p0: { x: number; z: number },
  p1: { x: number; z: number },
  p2: { x: number; z: number },
  p3: { x: number; z: number },
  u: number
): { x: number; z: number } {
  const u2 = u * u;
  const u3 = u2 * u;
  const x =
    0.5 *
    (2 * p1.x +
      (-p0.x + p2.x) * u +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3);
  const z =
    0.5 *
    (2 * p1.z +
      (-p0.z + p2.z) * u +
      (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * u2 +
      (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * u3);
  return { x, z };
}

export interface TrackDef {
  id: string;
  name: string;
  width: number;
  controlPoints: { x: number; z: number }[];
  /** Checkpoint positions as fractions of one lap (0..1), EXCLUDING the
   *  start/finish line. The finish is implicit when all checkpoints are passed
   *  and distAlongTrack wraps back near 0. Place the first checkpoint far
   *  enough from 0 so the spawned car doesn't trigger it immediately. */
  checkpoints: number[];
  /** Number of laps to complete for a valid run. */
  laps: number;
}

export interface TrackData {
  def: TrackDef;
  spline: TrackSpline;
  seed: string;
  /** Checkpoints resolved to distances along the spline. */
  checkpointDists: number[];
}

export function trackSeed(gameId: string, trackId: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`${gameId}|${trackId}`)));
}

export function buildTrack(def: TrackDef): TrackData {
  const spline = new TrackSpline(def.controlPoints);
  return {
    def,
    spline,
    seed: trackSeed("racer3d", def.id),
    checkpointDists: def.checkpoints.map((f) => f * spline.length),
  };
}

/**
 * Track #1 — "Oval Thunder". A simple closed oval, big enough to feel the
 * speed and the banking-free flat corners. Hand-tuned to be beginner-friendly:
 * wide road, gentle curvature, 3 checkpoints + start/finish, 2 laps.
 *
 * Control points are in the XZ plane (y is up, set to 0 — flat track for v1).
 */
export const TRACK_1: TrackDef = {
  id: "oval-thunder",
  name: "Oval Thunder",
  width: 14,
  controlPoints: [
    { x: 0, z: 0 },
    { x: 50, z: -10 },
    { x: 90, z: -50 },
    { x: 100, z: -120 },
    { x: 80, z: -190 },
    { x: 30, z: -220 },
    { x: -30, z: -220 },
    { x: -80, z: -190 },
    { x: -100, z: -120 },
    { x: -90, z: -50 },
    { x: -50, z: -10 },
  ],
  checkpoints: [0.25, 0.5, 0.75, 0],
  laps: 2,
};