import { useCallback, useEffect, useRef, useState } from "react";
import { InputRecorder } from "../../core/inputRecorder";
import { TickSync } from "../../core/tickSync";
import { GameInput } from "../../core/types";
import { Racer3DAction, Racer3DEngine, Racer3DState } from "../engine/racer3dEngine";
import { TrackData } from "../engine/track";

export interface Racer3DSession {
  state: Racer3DState;
  inputLog: GameInput[];
  finished: boolean;
  fps: number;
}

/**
 * Live-play loop for racer3d. Wires InputRecorder + TickSync + the R3F render
 * pump, exactly mirroring the 2D racer's pattern. The engine ticks in fixed
 * 16ms steps via TickSync (never rAF-dt directly) so live play and
 * `verifyReplay` agree bit-for-bit.
 *
 * `onState` is called every rAF frame with the latest engine state — R3F
 * components read from it to position the car/camera without triggering
 * React re-renders every frame.
 */
export function useRacer3D(
  track: TrackData,
  onState: (s: Racer3DState) => void,
  tickRef?: React.MutableRefObject<number>
) {
  const engineRef = useRef<Racer3DEngine | null>(null);
  const recorderRef = useRef<InputRecorder | null>(null);
  const tickSyncRef = useRef<TickSync<Racer3DAction> | null>(null);
  const heldKeysRef = useRef<Set<string>>(new Set());
  const pausedRef = useRef(false);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  if (!engineRef.current) {
    engineRef.current = new Racer3DEngine();
    engineRef.current.setTrack(track);
  }
  if (!recorderRef.current) recorderRef.current = new InputRecorder();
  if (!tickSyncRef.current) tickSyncRef.current = new TickSync();

  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const [inputLog, setInputLog] = useState<GameInput[] | null>(null);
  const [fps, setFps] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  const reset = useCallback(() => {
    const engine = engineRef.current!;
    engine.setTrack(track);
    engine.init(track.seed);
    recorderRef.current!.reset();
    tickSyncRef.current = new TickSync();
    pausedRef.current = false;
    setPaused(false);
    setFinished(false);
    setInputLog(null);
    setElapsedMs(0);
    onStateRef.current(engine.getState());
  }, [track]);

  useEffect(() => {
    reset();
  }, [reset]);

  // Simulation loop
  useEffect(() => {
    let raf = 0;
    let lastFpsT = performance.now();
    let frames = 0;
    const loop = () => {
      const engine = engineRef.current!;
      if (!engine.isGameOver() && !pausedRef.current) {
        tickSyncRef.current!.catchUpTo(engine, recorderRef.current!.elapsedNow());
        onStateRef.current(engine.getState());
        setElapsedMs(recorderRef.current!.elapsedNow());
      }
      frames++;
      const now = performance.now();
      if (now - lastFpsT >= 500) {
        setFps(Math.round((frames * 1000) / (now - lastFpsT)));
        frames = 0;
        lastFpsT = now;
      }
      if (engine.isGameOver() && !finished) {
        setFinished(true);
        setInputLog([...recorderRef.current!.getLog()]);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [finished]);

  const sendAction = useCallback((action: Racer3DAction) => {
    const engine = engineRef.current!;
    if (engine.isGameOver() || pausedRef.current) return;
    recorderRef.current!.record(action);
    const log = recorderRef.current!.getLog();
    const t = log[log.length - 1].t;
    tickSyncRef.current!.catchUpTo(engine, t);
    engine.applyInput(action, t);
  }, []);

  const togglePause = useCallback(() => {
    const engine = engineRef.current!;
    if (engine.isGameOver()) return;
    const next = !pausedRef.current;
    if (next) {
      if (heldKeysRef.current.has("ArrowLeft")) sendAction("left_up");
      if (heldKeysRef.current.has("ArrowRight")) sendAction("right_up");
      if (heldKeysRef.current.has("ArrowUp")) sendAction("accel_up");
      if (heldKeysRef.current.has("ArrowDown")) sendAction("brake_up");
      recorderRef.current!.pause();
      pausedRef.current = true;
    } else {
      pausedRef.current = false;
      recorderRef.current!.resume();
      if (heldKeysRef.current.has("ArrowLeft")) sendAction("left_down");
      if (heldKeysRef.current.has("ArrowRight")) sendAction("right_down");
      if (heldKeysRef.current.has("ArrowUp")) sendAction("accel_down");
      if (heldKeysRef.current.has("ArrowDown")) sendAction("brake_down");
    }
    setPaused(next);
  }, [sendAction]);

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "p" || e.key === "P") { e.preventDefault(); togglePause(); return; }
      const action = keyToActionDown(e.key);
      if (!action) return;
      e.preventDefault();
      if (heldKeysRef.current.has(e.key)) return;
      heldKeysRef.current.add(e.key);
      if (pausedRef.current) return;
      sendAction(action);
    };
    const up = (e: KeyboardEvent) => {
      const action = keyToActionUp(e.key);
      if (!action) return;
      if (!heldKeysRef.current.has(e.key)) return;
      heldKeysRef.current.delete(e.key);
      if (pausedRef.current) return;
      sendAction(action);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [sendAction, togglePause]);

  return {
    engineRef,
    recorderRef,
    paused,
    finished,
    inputLog,
    fps,
    elapsedMs,
    reset,
    togglePause,
    sendAction,
  };
}

function keyToActionDown(key: string): Racer3DAction | null {
  switch (key) {
    case "ArrowLeft": case "a": case "A": return "left_down";
    case "ArrowRight": case "d": case "D": return "right_down";
    case "ArrowUp": case "w": case "W": return "accel_down";
    case "ArrowDown": case "s": case "S": return "brake_down";
    default: return null;
  }
}
function keyToActionUp(key: string): Racer3DAction | null {
  switch (key) {
    case "ArrowLeft": case "a": case "A": return "left_up";
    case "ArrowRight": case "d": case "D": return "right_up";
    case "ArrowUp": case "w": case "W": return "accel_up";
    case "ArrowDown": case "s": case "S": return "brake_up";
    default: return null;
  }
}