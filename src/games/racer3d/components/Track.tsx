import React, { useMemo } from "react";
import * as THREE from "three";
import { TrackSpline } from "../engine/track";

/**
 * Builds a road mesh from the spline at runtime so the visual surface and
 * the engine's collision ribbon are always the same geometry. The road is
 * a flat ribbon in the XZ plane (y=0) with the given width, tessellated along
 * the spline. Both lane-edge lines and a center line are drawn for orientation.
 *
 * v1 additions for readable motion:
 * - alternating red/white barrier posts along each edge
 * - a checkered start/finish line at spline distance 0
 */
export default function TrackMesh({ spline, width }: { spline: TrackSpline; width: number }) {
  const { roadGeo, lineGeo, barrierPosts, finishGeo } = useMemo(
    () => buildRoadGeometry(spline, width),
    [spline, width]
  );
  return (
    <group>
      <mesh geometry={roadGeo} receiveShadow>
        <meshStandardMaterial color="#2a2a30" roughness={0.9} />
      </mesh>
      {/* Edge lines */}
      <line>
        <primitive object={lineGeo.left} attach="geometry" />
        <lineBasicMaterial color="#888" />
      </line>
      <line>
        <primitive object={lineGeo.right} attach="geometry" />
        <lineBasicMaterial color="#888" />
      </line>
      {/* Center dashed line (simple solid for v1) */}
      <line>
        <primitive object={lineGeo.center} attach="geometry" />
        <lineBasicMaterial color="#ddd" />
      </line>
      {/* Start/finish checkerboard */}
      <mesh geometry={finishGeo} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial color="#ffffff" roughness={0.8} />
      </mesh>
      {/* Barrier posts */}
      {barrierPosts.map((p, i) => (
        <mesh key={i} position={p.pos} castShadow receiveShadow>
          <boxGeometry args={[0.6, 1.2, 0.6]} />
          <meshStandardMaterial color={p.color} roughness={0.6} />
        </mesh>
      ))}
      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
        <planeGeometry args={[2000, 2000]} />
        <meshStandardMaterial color="#1a3a1a" roughness={1} />
      </mesh>
    </group>
  );
}

function buildRoadGeometry(spline: TrackSpline, width: number) {
  const N = 400;
  const halfW = width / 2;
  const positions: number[] = [];
  const indices: number[] = [];
  const left: THREE.Vector3[] = [];
  const right: THREE.Vector3[] = [];
  const center: THREE.Vector3[] = [];

  for (let i = 0; i <= N; i++) {
    const d = (i / N) * spline.length;
    const p = spline.positionAt(d);
    const t = spline.tangentAt(d);
    const nx = -t.z;
    const nz = t.x;
    const lx = p.x + nx * halfW;
    const lz = p.z + nz * halfW;
    const rx = p.x - nx * halfW;
    const rz = p.z - nz * halfW;
    positions.push(lx, 0.01, lz);
    positions.push(rx, 0.01, rz);
    left.push(new THREE.Vector3(lx, 0.02, lz));
    right.push(new THREE.Vector3(rx, 0.02, rz));
    center.push(new THREE.Vector3(p.x, 0.02, p.z));
    if (i < N) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  roadGeo.setIndex(indices);
  roadGeo.computeVertexNormals();

  const makeLine = (pts: THREE.Vector3[]) => {
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    return g;
  };

  // Barrier posts every ~10m, alternating red/white
  const barrierPosts: { pos: [number, number, number]; color: string }[] = [];
  const spacing = 10;
  const count = Math.floor(spline.length / spacing);
  for (let i = 0; i < count; i++) {
    const d = i * spacing;
    const p = spline.positionAt(d);
    const t = spline.tangentAt(d);
    const nx = -t.z;
    const nz = t.x;
    const color = i % 2 === 0 ? "#ff3333" : "#ffffff";
    barrierPosts.push({
      pos: [p.x + nx * (halfW + 0.8), 0.6, p.z + nz * (halfW + 0.8)],
      color,
    });
    barrierPosts.push({
      pos: [p.x - nx * (halfW + 0.8), 0.6, p.z - nz * (halfW + 0.8)],
      color,
    });
  }

  // Checkered start/finish line at distance 0
  const fHalf = halfW + 1;
  const fw = 3; // finish line depth along track
  const finishGeo = new THREE.PlaneGeometry(fHalf * 2, fw, 8, 2);
  // Checkerboard texture via canvas
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = "#000000";
  const sq = 16;
  for (let y = 0; y < 64; y += sq) {
    for (let x = 0; x < 128; x += sq) {
      if (((x / sq) + (y / sq)) % 2 === 0) ctx.fillRect(x, y, sq, sq);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;

  return {
    roadGeo,
    lineGeo: {
      left: makeLine(left),
      right: makeLine(right),
      center: makeLine(center),
    },
    barrierPosts,
    finishGeo,
    finishTex: tex,
  };
}
