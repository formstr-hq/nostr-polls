import React, { useRef } from "react";
import * as THREE from "three";

/**
 * Procedural low-poly car built from Three.js primitives — no external asset
 * for v1. The group's origin is the car's center; the engine places it at
 * (x, 0, z) and rotates by yaw around Y. Wheels turn with steerAngle (front
 * only) for visual feedback.
 *
 * Replacing this with a GLB later is a drop-in: load the GLB and set its
 * position/rotation from the same engine state — no engine changes needed.
 */
export default function Car({
  color = "#e53935",
  steerAngle = 0,
  ghost = false,
  opacity = 1,
}: {
  color?: string;
  steerAngle?: number;
  ghost?: boolean;
  opacity?: number;
}) {
  const frontLeftWheel = useRef<THREE.Group>(null);
  const frontRightWheel = useRef<THREE.Group>(null);

  React.useEffect(() => {
    if (frontLeftWheel.current) frontLeftWheel.current.rotation.y = steerAngle;
    if (frontRightWheel.current) frontRightWheel.current.rotation.y = steerAngle;
  }, [steerAngle]);

  const bodyMat = (
    <meshStandardMaterial
      color={color}
      roughness={0.4}
      metalness={0.3}
      transparent={opacity < 1}
      opacity={opacity}
      fog={false}
    />
  );

  return (
    <group>
      {/* Body */}
      <mesh castShadow position={[0, 0.5, 0]}>
        <boxGeometry args={[1.8, 0.5, 4]} />
        {bodyMat}
      </mesh>
      {/* Cabin */}
      <mesh castShadow position={[0, 0.9, -0.2]}>
        <boxGeometry args={[1.5, 0.4, 1.8]} />
        <meshStandardMaterial color="#222" roughness={0.2} metalness={0.5}
          transparent={opacity < 1} opacity={opacity} fog={false} />
      </mesh>
      {/* Front wheels (steerable) */}
      <group ref={frontLeftWheel} position={[-0.95, 0.35, 1.3]}>
        <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.35, 0.35, 0.25, 12]} />
          <meshStandardMaterial color="#111" roughness={0.8} fog={false} />
        </mesh>
      </group>
      <group ref={frontRightWheel} position={[0.95, 0.35, 1.3]}>
        <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.35, 0.35, 0.25, 12]} />
          <meshStandardMaterial color="#111" roughness={0.8} fog={false} />
        </mesh>
      </group>
      {/* Rear wheels (fixed) */}
      <mesh castShadow position={[-0.95, 0.35, -1.3]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.35, 0.35, 0.25, 12]} />
        <meshStandardMaterial color="#111" roughness={0.8} fog={false} />
      </mesh>
      <mesh castShadow position={[0.95, 0.35, -1.3]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.35, 0.35, 0.25, 12]} />
        <meshStandardMaterial color="#111" roughness={0.8} fog={false} />
      </mesh>
    </group>
  );
}