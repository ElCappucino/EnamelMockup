import { useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, ContactShadows, Environment, Lightformer } from '@react-three/drei'
import { ACESFilmicToneMapping, BackSide } from 'three'
import type { CanvasTexture, PointLight, Vector2 } from 'three'
import type { UVTransform } from '../lib/contour'
import type { RegionPiece } from '../hooks/useTracedDesign'
import type { EnamelType } from '../types'
import { PinMesh } from './PinMesh'

/** A light that follows the camera, so whatever face is turned toward the viewer stays lit
 * regardless of orbit angle — keeps recessed cavity walls from going pitch black. */
function CameraLight() {
  const light = useRef<PointLight>(null!)
  const { camera } = useThree()

  useFrame(() => {
    light.current.position.copy(camera.position)
  })

  return <pointLight ref={light} intensity={0.35} color="#ffffff" />
}

/** A procedural studio environment built from area lights. A metalness=1 surface has no diffuse
 * term — it can only show reflections — so without an environment map the plating renders nearly
 * black except for stray specular hits. This gives it something to actually reflect, and being
 * generated in-scene it needs no external HDRI file. */
function StudioEnvironment() {
  return (
    <Environment resolution={256} frames={1}>
      {/* Dim enclosing dome. Without it the gaps between the panels are pure black, and since a
          metal surface has no diffuse term (ambientLight can't reach it) the plating dropped to
          near-black whenever it faced a gap. This sets a floor so it always stays readable. */}
      <mesh scale={100}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial color="#3d4250" side={BackSide} />
      </mesh>
      {/* key */}
      <Lightformer form="rect" intensity={6} scale={[10, 10, 1]} position={[5, 5, 6]} />
      {/* cool fill from the left */}
      <Lightformer form="rect" intensity={3} color="#cfe0ff" scale={[10, 10, 1]} position={[-7, 3, 3]} />
      {/* warm bounce from below */}
      <Lightformer form="rect" intensity={2.5} color="#ffd9b8" scale={[10, 6, 1]} position={[0, -6, 4]} />
      {/* overhead ring — gives metal a curved highlight to sweep as it rotates */}
      <Lightformer form="ring" intensity={5} scale={6} position={[0, 7, -1]} />
      {/* rim light behind, so edges separate from the background */}
      <Lightformer form="rect" intensity={4} scale={[12, 12, 1]} position={[0, 0, -8]} />
    </Environment>
  )
}

interface PinCanvasProps {
  platingColor: string
  enamelType: EnamelType
  raisedHeight: number
  colorTexture: CanvasTexture | null
  bumpTexture: CanvasTexture | null
  outline: Vector2[] | null
  uv: UVTransform | null
  regions: RegionPiece[] | null
}

export function PinCanvas({
  platingColor,
  enamelType,
  raisedHeight,
  colorTexture,
  bumpTexture,
  outline,
  uv,
  regions,
}: PinCanvasProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 0.4, 6.2], fov: 32 }}
      gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
    >
      <color attach="background" args={['#1b1b1f']} />

      <StudioEnvironment />

      {/* The environment supplies most of the fill, so the punctual lights only add shaping and
          the shadow-casting key. */}
      <ambientLight intensity={0.18} />
      <directionalLight
        position={[3, 4, 4]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-3, 2, -2]} intensity={0.35} color="#a5c8ff" />
      <CameraLight />

      <PinMesh
        platingColor={platingColor}
        enamelType={enamelType}
        raisedHeight={raisedHeight}
        colorTexture={colorTexture}
        bumpTexture={bumpTexture}
        outline={outline}
        uv={uv}
        regions={regions}
      />

      <ContactShadows
        position={[0, -0.9, 0]}
        opacity={0.55}
        scale={6}
        blur={2.6}
        far={2}
        resolution={1024}
      />

      <OrbitControls
        enablePan={false}
        minDistance={2.4}
        maxDistance={7}
        minPolarAngle={Math.PI / 4}
        maxPolarAngle={Math.PI - Math.PI / 4}
      />
    </Canvas>
  )
}
