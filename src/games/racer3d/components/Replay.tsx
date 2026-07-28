import React, { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Button, Stack, Typography } from "@mui/material";
import { GameInput } from "../../core/types";
import { useReplayPlayback } from "../../core/useReplayPlayback";
import TrackMesh from "./Track";
import Car from "./Car";
import { buildTrack, TRACK_1 } from "../engine/track";
import { Racer3DEngine } from "../engine/racer3dEngine";

const track = buildTrack(TRACK_1);

function ReplayScene({ engine }: { engine: Racer3DEngine | null }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!engine || !ref.current) return;
    const s = engine.getState();
    ref.current.position.set(s.car.x, 0, s.car.z);
    ref.current.rotation.y = s.car.yaw;
  });
  return (
    <group ref={ref}>
      <Car steerAngle={engine?.getState().car.steerAngle ?? 0} color="#e53935" />
    </group>
  );
}

function ReplayCamera({ engine }: { engine: Racer3DEngine | null }) {
  useFrame((state) => {
    if (!engine) return;
    const car = engine.getState().car;
    const sinY = Math.sin(car.yaw);
    const cosY = Math.cos(car.yaw);
    const behind = 12;
    const up = 5;
    const ahead = 6;
    state.camera.position.set(car.x - sinY * behind, up, car.z - cosY * behind);
    state.camera.lookAt(car.x + sinY * ahead, 1, car.z + cosY * ahead);
  });
  return null;
}

export default function Racer3DReplay({ seed, inputLog }: { seed: string; inputLog: GameInput[] }) {
  const factory = () => {
    const e = new Racer3DEngine();
    e.setTrack(track);
    return e;
  };
  const playback = useReplayPlayback(factory, seed, inputLog);
  const engine = playback.engine as Racer3DEngine | null;

  return (
    <Stack alignItems="center" spacing={1} sx={{ width: "100%", height: 360 }}>
      <div style={{ width: "100%", height: "100%", borderRadius: 8, overflow: "hidden" }}>
        <Canvas shadows camera={{ fov: 70, position: [0, 8, 20], near: 0.1, far: 1000 }}>
          <color attach="background" args={["#87ceeb"]} />
          <fog attach="fog" args={["#87ceeb", 120, 600]} />
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
          <ReplayScene engine={engine} />
          <ReplayCamera engine={engine} />
        </Canvas>
      </div>
      <Stack direction="row" spacing={1}>
        <Button size="small" variant="outlined" onClick={playback.playing ? playback.pause : playback.play}>
          {playback.playing ? "Pause" : "Play"}
        </Button>
        <Button size="small" variant="outlined" onClick={playback.restart}>
          Restart
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {((playback.clockMs / 1000) % 60).toFixed(1)}s /{" "}
        {playback.durationMs ? (playback.durationMs / 1000).toFixed(1) : "0.0"}s
      </Typography>
    </Stack>
  );
}
