import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Button, IconButton, Stack, Typography } from "@mui/material";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import Car from "./Car";
import TrackMesh from "./Track";
import GhostCars from "./GhostCars";
import Minimap from "./Minimap";
import TouchControls from "./TouchControls";
import Racer3DReplay from "./Replay";
import { useRacer3D } from "../hooks/useRacer3D";
import { useGhostReplays } from "../hooks/useGhostReplays";
import { Racer3DEngine, Racer3DState } from "../engine/racer3dEngine";
import { buildTrack, TRACK_1 } from "../engine/track";
import { useUserContext } from "../../../hooks/useUserContext";
import { useTrackLeaderboard, LeaderboardEntry } from "../../core/useTrackLeaderboard";
import { verifyReplay } from "../../core/replayEngine";
import {
  StoredScore,
  getTrackSeed,
  getMyTrackScore,
  parseScoreEvent,
  publishTrackScore,
} from "../../core/scoreEvents";
import GameLeaderboardModal from "../../../components/Games/GameLeaderboardModal";
import ShareScoreButton from "../../../components/Games/ShareScoreButton";

const GAME_ID = "racer3d";
const TRACK_ID = "oval-thunder";
const track = buildTrack(TRACK_1);
const seed = getTrackSeed(GAME_ID, TRACK_ID);
// Anything under 5 seconds for 2 laps is an artifact of the old checkpoint bug.
const MIN_VALID_SCORE_MS = 5000;

/**
 * Camera follows the car from behind, like Trackmania's default chase cam.
 * Three.js rotation.y=0 faces +Z, so forward world vector is (sin(yaw), 0, cos(yaw)).
 */
function ChaseCamera({ stateRef }: { stateRef: React.MutableRefObject<Racer3DState> }) {
  const { camera } = useThree();
  const camPos = useRef(new THREE.Vector3(0, 8, 20));
  const lookAt = useRef(new THREE.Vector3());

  useFrame(() => {
    const s = stateRef.current;
    const car = s.car;
    const sinY = Math.sin(car.yaw);
    const cosY = Math.cos(car.yaw);
    const behind = 12;
    const up = 5;
    const ahead = 6;
    const targetX = car.x - sinY * behind;
    const targetZ = car.z - cosY * behind;
    camPos.current.lerp(new THREE.Vector3(targetX, up, targetZ), 0.12);
    camera.position.copy(camPos.current);
    lookAt.current.lerp(new THREE.Vector3(
      car.x + sinY * ahead,
      1,
      car.z + cosY * ahead,
    ), 0.3);
    camera.lookAt(lookAt.current);
  });
  return null;
}

/** Renders the live car at its current engine position every frame. */
function LiveCar({ stateRef }: { stateRef: React.MutableRefObject<Racer3DState> }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const s = stateRef.current;
    if (!ref.current) return;
    ref.current.position.set(s.car.x, 0, s.car.z);
    ref.current.rotation.y = s.car.yaw;
  });
  return (
    <group ref={ref}>
      <Car steerAngle={stateRef.current.car.steerAngle} color="#e53935" />
    </group>
  );
}

function formatTime(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(2);
  return `${m}:${rest.padStart(5, "0")}`;
}

function racer3dFactory() {
  const e = new Racer3DEngine();
  e.setTrack(track);
  return e;
}

export default function Racer3DBoard() {
  const { user } = useUserContext();
  const stateRef = useRef<Racer3DState>(blankState());
  const {
    recorderRef,
    paused,
    finished,
    inputLog,
    fps,
    elapsedMs,
    reset,
    togglePause,
    sendAction,
  } = useRacer3D(track, (s) => { stateRef.current = s; });

  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [watchingReplay, setWatchingReplay] = useState(false);
  const [publishedThisRun, setPublishedThisRun] = useState(false);
  const [bestStored, setBestStored] = useState<StoredScore | null>(null);
  const [publishStatus, setPublishStatus] = useState<string>("");
  const publishingRef = useRef(false);

  const leaderboard = useTrackLeaderboard(GAME_ID, TRACK_ID, racer3dFactory);

  // Build the ghost entry list: always include the user's own best (if any),
  // plus the top leaderboard entries. This guarantees at least one ghost once
  // the player has published a run.
  const candidateEntries: LeaderboardEntry[] = useMemo(() => {
    const own = bestStored
      ? {
          pubkey: bestStored.pubkey,
          score: bestStored.score,
          verified: true,
          createdAt: bestStored.event.created_at,
          seed: bestStored.seed,
          inputLog: bestStored.inputLog,
        }
      : null;
    const ownInLeaderboard = leaderboard.some((e) => e.pubkey === user?.pubkey);
    if (own && !ownInLeaderboard) {
      return [own, ...leaderboard];
    }
    return leaderboard;
  }, [bestStored, leaderboard, user?.pubkey]);

  // Freeze the leaderboard entries for ghosts once the race has been running
  // a short moment, so new entries mid-race don't reset ghosts.
  const [ghostEntries, setGhostEntries] = useState<LeaderboardEntry[]>([]);
  const [raceStarted, setRaceStarted] = useState(false);
  useEffect(() => {
    if (finished || !raceStarted) return;
    if (ghostEntries.length === 0 && candidateEntries.length > 0) {
      setGhostEntries(candidateEntries);
    }
  }, [candidateEntries, raceStarted, finished, ghostEntries.length]);

  // Start the race clock for ghosts after first input or 1 second.
  useEffect(() => {
    if (raceStarted) return;
    const id = setTimeout(() => setRaceStarted(true), 1000);
    return () => clearTimeout(id);
  }, [raceStarted]);

  const ghosts = useGhostReplays(track, ghostEntries, elapsedMs, raceStarted && !finished);

  // Stable ref for touch controls to call sendAction without re-renders.
  const sendActionRef = useRef(sendAction);
  sendActionRef.current = sendAction;

  // Fetch the user's own best for this track, and verify it. Old invalid
  // scores from buggy builds (e.g. the 0.13s auto-finish checkpoint bug) will
  // fail verification and be discarded so new runs can publish.
  useEffect(() => {
    if (!user?.pubkey) return;
    let alive = true;
    getMyTrackScore(GAME_ID, TRACK_ID, user.pubkey).then((stored) => {
      if (!alive || !stored) return;
      if (stored.seed !== seed) {
        console.warn("[racer3d] stored best seed mismatch, discarding");
        return;
      }
      if (stored.score < MIN_VALID_SCORE_MS) {
        console.warn("[racer3d] stored best is impossibly fast (old checkpoint bug), discarding", stored.score);
        return;
      }
      try {
        const result = verifyReplay(racer3dFactory, stored.seed, stored.inputLog);
        if (result.score !== stored.score || !result.gameOver) {
          console.warn("[racer3d] stored best failed verification, discarding", result, stored.score);
          return;
        }
        console.log("[racer3d] stored best verified", stored.score);
        setBestStored(stored);
      } catch (err) {
        console.warn("[racer3d] stored best verify threw, discarding", err);
      }
    });
    return () => { alive = false; };
  }, [user?.pubkey]);

  // Publish on finish if it's a new best and a realistic time.
  useEffect(() => {
    if (!finished || publishedThisRun || publishingRef.current) return;
    const score = stateRef.current.raceTimeMs;
    if (!user?.pubkey) {
      setPublishStatus("Not signed in — score not published");
      return;
    }
    console.log("[racer3d] finished, score", score, "bestStored", bestStored?.score ?? "none");
    if (score < MIN_VALID_SCORE_MS) {
      setPublishStatus(`Run too fast (${score}ms) — not published`);
      return;
    }
    if (bestStored !== null && score >= bestStored.score) {
      setPublishStatus(`Not a new best (${formatTime(score)} vs ${formatTime(bestStored.score)})`);
      return;
    }
    if (!recorderRef.current) return;
    setPublishStatus("Publishing...");
    publishingRef.current = true;
    publishTrackScore(GAME_ID, TRACK_ID, seed, score, recorderRef.current.getLog())
      .then((signed) => {
        const stored = parseScoreEvent(signed);
        if (stored) {
          console.log("[racer3d] published score", stored.score);
          setBestStored(stored);
          setPublishStatus(`Published ${formatTime(stored.score)}`);
        } else {
          console.error("[racer3d] failed to parse signed score event");
          setPublishStatus("Publish parse failed");
        }
        setPublishedThisRun(true);
      })
      .catch((err) => {
        console.error("[racer3d] publishTrackScore failed", err);
        setPublishStatus(`Publish failed: ${err.message || err}`);
      })
      .finally(() => {
        publishingRef.current = false;
      });
  }, [finished, publishedThisRun, bestStored, user?.pubkey, recorderRef]);

  const onReset = useCallback(() => {
    reset();
    setRaceStarted(false);
    setGhostEntries([]);
    setPublishedThisRun(false);
    setWatchingReplay(false);
  }, [reset]);

  return (
    <Stack alignItems="center" spacing={1} sx={{ p: 1, height: "100%", overflow: "hidden" }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Typography variant="h6">Racer3D — {track.def.name}</Typography>
        <Typography variant="caption" color="text.secondary">{fps} fps</Typography>
        <IconButton size="small" onClick={() => setLeaderboardOpen(true)} aria-label="Leaderboard">
          <EmojiEventsIcon />
        </IconButton>
      </Stack>
      <Stack direction="row" spacing={2}>
        <Typography variant="body2">
          Time: {formatTime(stateRef.current.raceTimeMs)}
        </Typography>
        <Typography variant="body2">
          Lap: {stateRef.current.finished ? track.def.laps : stateRef.current.lap + 1}/{track.def.laps}
        </Typography>
        <Typography variant="body2">
          Speed: {Math.abs(stateRef.current.car.speed).toFixed(0)} m/s
        </Typography>
        {bestStored && (
          <Typography variant="body2" sx={{ cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted" }}
            onClick={() => setLeaderboardOpen(true)}>
            Best: {formatTime(bestStored.score)}
          </Typography>
        )}
      </Stack>

      <div style={{ width: "100%", height: "70vh", minHeight: 400, borderRadius: 8, overflow: "hidden", position: "relative" }}>
        {watchingReplay && inputLog ? (
          <Racer3DReplay seed={seed} inputLog={inputLog} />
        ) : (
          <Canvas shadows camera={{ fov: 70, position: [0, 8, 20], near: 0.1, far: 1000 }}>
            <color attach="background" args={["#87ceeb"]} />
            <fog attach="fog" args={["#87ceeb", 200, 1200]} />
            <ambientLight intensity={0.5} />
            <directionalLight
              castShadow
              position={[50, 80, 30]}
              intensity={1.2}
              shadow-mapSize-width={2048}
              shadow-mapSize-height={2048}
              shadow-camera-far={300}
              shadow-camera-left={-100}
              shadow-camera-right={100}
              shadow-camera-top={100}
              shadow-camera-bottom={-100}
            />
            <TrackMesh spline={track.spline} width={track.def.width} />
            <LiveCar stateRef={stateRef} />
            <GhostCars ghosts={ghosts} />
            <ChaseCamera stateRef={stateRef} />
          </Canvas>
        )}
        {/* Minimap */}
        {!watchingReplay && <Minimap spline={track.spline} playerState={stateRef.current} ghosts={ghosts} />}
        {/* Touch controls for mobile */}
        {!watchingReplay && <TouchControls sendAction={sendActionRef.current} />}
        {/* Screen-space in-game HUD overlay — stuck to the canvas, not the track */}
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 4,
            padding: "10px 18px",
            background: "rgba(0,0,0,0.55)",
            borderRadius: 12,
            backdropFilter: "blur(4px)",
            color: "#fff",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
            minWidth: 180,
            pointerEvents: "none",
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 1 }}>{formatTime(stateRef.current.raceTimeMs)}</div>
          <div style={{ display: "flex", gap: 16, fontSize: 13, fontWeight: 600 }}>
            <span>Lap {stateRef.current.finished ? track.def.laps : stateRef.current.lap + 1}/{track.def.laps}</span>
            <span>{Math.abs(stateRef.current.car.speed).toFixed(0)} m/s</span>
            <span>Ghosts: {ghosts.length}</span>
          </div>
          <Speedometer speed={Math.abs(stateRef.current.car.speed)} max={70} />
        </div>
        {ghosts.length === 0 && !finished && (
          <div
            style={{
              position: "absolute",
              top: 12,
              left: "50%",
              transform: "translateX(-50%)",
              padding: "6px 12px",
              background: "rgba(0,0,0,0.5)",
              borderRadius: 8,
              color: "#fff",
              fontSize: 12,
              pointerEvents: "none",
            }}
          >
            No ghosts yet — finish a run to race your own replay
          </div>
        )}
      </div>
      <Stack direction="row" spacing={1}>
        <Button size="small" variant="outlined" onClick={togglePause}>
          {paused ? "Resume" : "Pause"}
        </Button>
        <Button size="small" variant="outlined" onClick={onReset}>Restart</Button>
        {finished && inputLog && (
          <Button size="small" variant="outlined" onClick={() => setWatchingReplay((w) => !w)}>
            {watchingReplay ? "Back to track" : "Watch replay"}
          </Button>
        )}
        {finished && <ShareScoreButton gameLabel="Racer3D" gameId={GAME_ID} score={stateRef.current.raceTimeMs} dateIso={TRACK_ID} />}
      </Stack>
      {paused && <Typography color="warning.main" fontWeight={600}>Paused</Typography>}
      {finished && (
        <Typography color="success.main" fontWeight={600}>
          Finished! Time: {formatTime(stateRef.current.raceTimeMs)}
          {publishedThisRun ? " (published)" : ""}
        </Typography>
      )}
      {publishStatus && (
        <Typography variant="caption" color="text.secondary">
          {publishStatus}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary">
        Arrow keys / WASD to drive — hold to steer/accel/brake; P to pause
      </Typography>

      <GameLeaderboardModal
        open={leaderboardOpen}
        onClose={() => setLeaderboardOpen(false)}
        label="Racer3D"
        gameId={GAME_ID}
        dateIso={TRACK_ID}
        gameFactory={racer3dFactory}
        ReplayView={Racer3DReplay}
        formatScore={formatTime}
      />
    </Stack>
  );
}

function blankState(): Racer3DState {
  return {
    car: { x: 0, z: 0, yaw: 0, speed: 0, steerAngle: 0, onTrack: true, distAlongTrack: 0, lateralOffset: 0 },
    nextCheckpoint: 0, lap: 0, finished: false, raceTimeMs: 0, distance: 0,
  };
}

function Speedometer({ speed, max }: { speed: number; max: number }) {
  const ratio = Math.min(speed / max, 1);
  const arcDeg = ratio * 180;
  const arcPath = describeArc(50, 50, 40, 180, 180 + arcDeg);
  return (
    <svg width={100} height={55}>
      <path d={describeArc(50, 50, 40, 180, 360)} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={6} strokeLinecap="round" />
      <path d={arcPath} fill="none" stroke="#4ade80" strokeWidth={6} strokeLinecap="round" />
    </svg>
  );
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const start = polarToCartesian(cx, cy, r, endDeg);
  const end = polarToCartesian(cx, cy, r, startDeg);
  const largeArc = endDeg - startDeg <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}