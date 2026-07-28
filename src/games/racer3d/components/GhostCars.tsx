import React, { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Avatar, Chip } from "@mui/material";
import Car from "./Car";
import { Ghost } from "../hooks/useGhostReplays";
import { Racer3DState } from "../engine/racer3dEngine";
import { useAppContext } from "../../../hooks/useAppContext";
import { nip19 } from "nostr-tools";

interface GhostCarsProps {
  ghosts: Ghost[];
}

/** Renders verified leaderboard entries as translucent ghost cars in sync
 *  with the live player's tick clock, with kind:0 name/avatar labels. */
export default function GhostCars({ ghosts }: GhostCarsProps) {
  return (
    <>
      {ghosts.map((ghost) => (
        <GhostCar key={ghost.pubkey} ghost={ghost} color={ghost.color} />
      ))}
    </>
  );
}

function GhostCar({ ghost, color }: { ghost: Ghost; color: string }) {
  const ref = useRef<THREE.Group>(null);
  const stateRef = useRef<Racer3DState | null>(null);
  const { profiles, fetchUserProfileThrottled } = useAppContext();

  React.useEffect(() => {
    fetchUserProfileThrottled(ghost.pubkey);
  }, [ghost.pubkey, fetchUserProfileThrottled]);

  useFrame(() => {
    const s = ghost.engine.getState();
    stateRef.current = s;
    if (!ref.current) return;
    ref.current.position.set(s.car.x, 0, s.car.z);
    ref.current.rotation.y = s.car.yaw;
  });

  const profile = profiles?.get(ghost.pubkey);
  const npub = nip19.npubEncode(ghost.pubkey) as `npub1${string}`;
  const displayName = profile?.name || profile?.username || `${npub.slice(0, 12)}…`;

  return (
    <group ref={ref}>
      <Car steerAngle={stateRef.current?.car.steerAngle ?? 0} color={color} ghost opacity={0.6} />
      <Html position={[0, 2.2, 0]} center distanceFactor={8}>
        <Chip
          size="small"
          avatar={<Avatar src={profile?.picture} alt={displayName} sx={{ width: 20, height: 20 }} />}
          label={displayName}
          sx={{
            bgcolor: "rgba(0,0,0,0.6)",
            color: "#fff",
            fontWeight: 600,
            fontSize: 12,
            backdropFilter: "blur(2px)",
            "& .MuiChip-label": { px: 1 },
          }}
        />
      </Html>
    </group>
  );
}
