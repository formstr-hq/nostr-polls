import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { DeterministicGame } from "../../core/types";
import { Rng, rngFromHexSeed } from "../../core/prng";
import { TrackData, trackSeed } from "./track";

/**
 * Discrete key events only — the engine ramps continuous steering/throttle
 * from held-key state every fixed tick. Same scheme as the 2D racer and
 * Trackmania itself: small input log, fully deterministic, keyboard-native.
 */
export type Racer3DAction =
  | "left_down" | "left_up"
  | "right_down" | "right_up"
  | "accel_down" | "accel_up"
  | "brake_down" | "brake_up";

// --- Tuning constants (arcade-friendly, easy to adjust) -------------------
const STEER_RATE = 2.8;        // rad/sec — how fast the wheel turns
const STEER_MAX = 0.55;         // rad — max steering angle from center
const STEER_RETURN = 3.0;      // rad/sec — auto-center speed when no key held
const ENGINE_POWER = 18.0;     // m/s^2 — forward acceleration
const BRAKE_POWER = 22.0;      // m/s^2 — braking deceleration
const DRAG = 0.15;             // 1/s — linear air drag on forward speed
const ROLL_RESIST = 0.12;      // 1/s — rolling resistance
const MAX_SPEED = 70;          // m/s cap (~252 km/h)
const WHEEL_BASE = 2.6;         // m — bicycle-model distance
const OFFTRACK_SPEED_MULT = 0.35; // speed multiplier when off the road
const OFFTRACK_DRAG_BOOST = 3.0;  // extra drag when off-road
const WALL_BOUNCE = 0.3;       // velocity retained after hitting road edge
const CHECKPOINT_RADIUS = 8;   // m — how close to trigger a checkpoint
const START_SPEED = 0;         // m/s — initial speed (standing start)

export interface CarState {
  x: number; z: number;          // world position
  yaw: number;                   // heading (radians, atan2(sin, cos) form)
  speed: number;                 // forward speed (m/s, can go negative for reverse)
  steerAngle: number;            // current steering angle (rad)
  onTrack: boolean;              // whether the car is within the road ribbon
  distAlongTrack: number;        // progress distance on the spline (m)
  lateralOffset: number;         // signed distance from track centerline (m)
}

export interface Racer3DState {
  car: CarState;
  nextCheckpoint: number;
  lap: number;
  finished: boolean;
  /** Total elapsed race time in ms — this IS the score (lower is better). */
  raceTimeMs: number;
  /** Distance traveled (m) — cosmetic, shown in HUD. */
  distance: number;
}

export class Racer3DEngine implements DeterministicGame<Racer3DAction> {
  private rng!: Rng;
  private track!: TrackData;
  private s: Racer3DState = blankState();

  // Held-key state (set by applyInput, read by tick)
  private leftHeld = false;
  private rightHeld = false;
  private accelHeld = false;
  private brakeHeld = false;

  init(seed: string): void {
    this.rng = rngFromHexSeed(seed);
    // The track is identified by the seed (sha256 of gameId|trackId), so we
    // look it up. In the live game the host passes the TrackData in via
    // setTrack() before init(); verifyReplay does the same — see
    // racer3dFactory in hooks/useRacer3D.ts.
    if (!this.track) throw new Error("Racer3DEngine.init: track not set; call setTrack() first");
    if (trackSeed("racer3d", this.track.def.id) !== seed) {
      throw new Error("Racer3DEngine.init: seed does not match track id");
    }
    this.s = blankState();
    this.leftHeld = false;
    this.rightHeld = false;
    this.accelHeld = false;
    this.brakeHeld = false;
    // Place car at start/finish, facing forward along the spline.
    const startDist = 0;
    const pos = this.track.spline.positionAt(startDist);
    const heading = this.track.spline.headingAt(startDist);
    this.s.car.x = pos.x;
    this.s.car.z = pos.z;
    this.s.car.yaw = heading;
    this.s.car.speed = START_SPEED;
    this.s.car.distAlongTrack = startDist;
  }

  setTrack(track: TrackData): void {
    this.track = track;
  }

  applyInput(action: Racer3DAction, _t: number): void {
    switch (action) {
      case "left_down": this.leftHeld = true; break;
      case "left_up": this.leftHeld = false; break;
      case "right_down": this.rightHeld = true; break;
      case "right_up": this.rightHeld = false; break;
      case "accel_down": this.accelHeld = true; break;
      case "accel_up": this.accelHeld = false; break;
      case "brake_down": this.brakeHeld = true; break;
      case "brake_up": this.brakeHeld = false; break;
    }
  }

  tick(dtMs: number): void {
    if (this.s.finished) return;
    const dt = dtMs / 1000;
    const car = this.s.car;

    // --- Steering: ramp toward target, auto-return when released -------
    const steerInput = (this.leftHeld ? -1 : 0) + (this.rightHeld ? 1 : 0);
    if (steerInput !== 0) {
      car.steerAngle += steerInput * STEER_RATE * dt;
      car.steerAngle = clamp(car.steerAngle, -STEER_MAX, STEER_MAX);
    } else {
      // Auto-center: move steerAngle toward 0
      const ret = STEER_RETURN * dt;
      if (Math.abs(car.steerAngle) <= ret) car.steerAngle = 0;
      else car.steerAngle -= Math.sign(car.steerAngle) * ret;
    }

    // --- Longitudinal: throttle / brake / drag --------------------------
    if (this.accelHeld) {
      car.speed += ENGINE_POWER * dt;
    }
    if (this.brakeHeld) {
      // Brake if moving forward, reverse if stopped/slow
      if (car.speed > 0.5) {
        car.speed -= BRAKE_POWER * dt;
      } else {
        car.speed -= ENGINE_POWER * 0.5 * dt; // gentle reverse
      }
    }
    // Drag + rolling resistance
    car.speed -= car.speed * (DRAG + ROLL_RESIST) * dt;
    car.speed = clamp(car.speed, -MAX_SPEED * 0.3, MAX_SPEED);

    // --- Off-track penalty ---------------------------------------------
    // Recompute track projection to see if we're on the road ribbon.
    this.projectToTrack();
    const halfWidth = this.track.def.width / 2;
    const onTrack = Math.abs(car.lateralOffset) <= halfWidth;
    car.onTrack = onTrack;
    if (!onTrack) {
      car.speed *= 1 - OFFTRACK_DRAG_BOOST * dt;
      car.speed = Math.min(car.speed, MAX_SPEED * OFFTRACK_SPEED_MULT);
    }

    // --- Bicycle model integration -------------------------------------
    // Update yaw from steering (bicycle model). Sign is flipped relative to the
    // raw formula so that, with the chase camera behind the car, left input
    // turns the car left on screen and right input turns it right.
    car.yaw -= (car.speed / WHEEL_BASE) * Math.tan(car.steerAngle) * dt;
    // Normalize yaw to [-pi, pi] for stable numerics
    car.yaw = normalizeAngle(car.yaw);

    // Move (Three.js convention: rotation.y=0 faces +Z, so forward is (sin(yaw), cos(yaw)))
    const dx = Math.sin(car.yaw) * car.speed * dt;
    const dz = Math.cos(car.yaw) * car.speed * dt;
    car.x += dx;
    car.z += dz;

    // --- Wall: clamp to road edge with a bounce ------------------------
    this.projectToTrack();
    if (Math.abs(car.lateralOffset) > halfWidth) {
      // Push back to edge and kill some speed
      const overshoot = Math.abs(car.lateralOffset) - halfWidth;
      const sign = Math.sign(car.lateralOffset);
      // Move the car back toward the road by projecting the overshoot
      // along the track normal.
      const t = this.track.spline.tangentAt(car.distAlongTrack);
      const nx = -t.z; // normal = perpendicular to tangent
      const nz = t.x;
      car.x -= nx * sign * overshoot;
      car.z -= nz * sign * overshoot;
      car.speed *= WALL_BOUNCE;
      this.projectToTrack();
    }

    // --- Checkpoints / lap / finish ------------------------------------
    this.s.raceTimeMs += dtMs;
    this.s.distance += Math.abs(car.speed) * dt;
    this.checkCheckpoints();
  }

  getScore(): number {
    // Score is race time in ms (lower is better). For the leaderboard we
    // store this as-is and sort ascending. Use a large base so that a
    // "didn't finish" (score 0) ranks last.
    return this.s.finished ? Math.round(this.s.raceTimeMs) : 0;
  }

  isGameOver(): boolean {
    return this.s.finished;
  }

  getStateHash(): string {
    const c = this.s.car;
    const flat = [
      c.x.toFixed(3), c.z.toFixed(3),
      c.yaw.toFixed(4), c.speed.toFixed(3),
      c.steerAngle.toFixed(4),
      this.s.lap, this.s.nextCheckpoint,
      this.s.raceTimeMs,
    ].join("|");
    return bytesToHex(sha256(new TextEncoder().encode(flat))).slice(0, 16);
  }

  // --- Public read API for the renderer (never feeds back into sim) ------
  getState(): Racer3DState { return this.s; }
  getTrack(): TrackData { return this.track; }

  // --- internals --------------------------------------------------------
  private projectToTrack(): void {
    // Find nearest point on spline to the car. For v1 we sample the spline
    // at a fixed resolution and pick the closest — cheap and deterministic.
    // 200 samples across the loop is plenty for a smooth spline.
    const N = 256;
    const car = this.s.car;
    let bestDist = 0;
    let bestD2 = Infinity;
    const len = this.track.spline.length;
    for (let i = 0; i < N; i++) {
      const d = (i / N) * len;
      const p = this.track.spline.positionAt(d);
      const dx = p.x - car.x;
      const dz = p.z - car.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; bestDist = d; }
    }
    // For a closed loop, positionAt(0) == positionAt(len). Sampling may pick
    // the len sample at the start/finish, which would immediately trigger the
    // finish-line checkpoint. Wrap to [0, len) so 0 is unambiguous.
    car.distAlongTrack = bestDist >= len ? bestDist - len : bestDist;
    // Lateral offset = signed distance from centerline, sign relative to
    // the track's forward direction.
    const p = this.track.spline.positionAt(bestDist);
    const t = this.track.spline.tangentAt(bestDist);
    const nx = -t.z;
    const nz = t.x;
    car.lateralOffset = (car.x - p.x) * nx + (car.z - p.z) * nz;
  }

  private checkCheckpoints(): void {
    const car = this.s.car;
    const cps = this.track.checkpointDists;
    const target = cps[this.s.nextCheckpoint];
    const distToCp = signedArcDistance(car.distAlongTrack, target, this.track.spline.length);
    if (Math.abs(distToCp) < CHECKPOINT_RADIUS) {
      this.s.nextCheckpoint++;
      if (this.s.nextCheckpoint >= cps.length) {
        this.s.lap++;
        this.s.nextCheckpoint = 0;
        if (this.s.lap >= this.track.def.laps) {
          this.s.finished = true;
        }
      }
    }
  }
}

// --- helpers --------------------------------------------------------------
function blankState(): Racer3DState {
  return {
    car: {
      x: 0, z: 0, yaw: 0, speed: 0, steerAngle: 0,
      onTrack: true, distAlongTrack: 0, lateralOffset: 0,
    },
    nextCheckpoint: 0,
    lap: 0,
    finished: false,
    raceTimeMs: 0,
    distance: 0,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Shortest signed arc distance from `from` to `to` on a loop of `len`. */
function signedArcDistance(from: number, to: number, len: number): number {
  let d = (to - from) % len;
  if (d > len / 2) d -= len;
  if (d < -len / 2) d += len;
  return d;
}

