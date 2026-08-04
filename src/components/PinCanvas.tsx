import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, ContactShadows, Environment, Lightformer, Html } from '@react-three/drei'
import { ACESFilmicToneMapping, BackSide, MathUtils } from 'three'
import type { CanvasTexture, PerspectiveCamera, PointLight, Vector2 } from 'three'
import type { UVTransform } from '../lib/contour'
import type { RegionPiece } from '../hooks/useTracedDesign'
import {
  MM_PER_WORLD_UNIT,
  type EnamelType,
  type PinPlacement,
  type Product,
  type ProductId,
} from '../types'
import { PinMesh } from './PinMesh'
import { ProductScene, type ProductBounds } from './ProductScene'

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

const PIN_ONLY_CAMERA: [number, number, number] = [0, 0.4, 6.2]

/** Hoisted so it isn't a fresh object on every render, which would have R3F re-applying the
 * camera's initial props. */
const CAMERA_PROPS = { position: PIN_ONLY_CAMERA, fov: 32 }
const GL_PROPS = {
  antialias: true,
  toneMapping: ACESFilmicToneMapping,
  toneMappingExposure: 1.1,
}

/** Pulls the camera back far enough to frame whatever is on screen. Products differ hugely in
 * size — the tote is ~7.5 units tall, the cap ~1.6 — so a fixed distance can't serve both.
 *
 * Framing happens once per product and never again. Anything that re-runs this effect on an
 * ordinary re-render would otherwise snatch the camera back from wherever the user had orbited
 * to, every time they touched a slider. Keying off the product rather than the effect's inputs
 * makes that impossible regardless of which dependency churns. */
function CameraRig({ bounds, productId }: { bounds: ProductBounds | null; productId: ProductId }) {
  // Individual selectors, so this doesn't re-render on unrelated store updates.
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const framedFor = useRef<ProductId | null>(null)

  useEffect(() => {
    if (framedFor.current === productId) return
    const cam = camera as PerspectiveCamera

    if (!bounds) {
      // A product is selected but hasn't been measured yet — wait rather than framing on the
      // previous product's bounds.
      if (productId !== 'none') return
      cam.position.set(...PIN_ONLY_CAMERA)
      cam.near = 0.1
      cam.far = 100
      cam.updateProjectionMatrix()
      framedFor.current = productId
      return
    }

    const [cx, cy, cz] = bounds.center
    const vFov = MathUtils.degToRad(cam.fov)
    const aspect = size.width / Math.max(size.height, 1)
    // Fit vertically and horizontally, then take whichever needs more room.
    const distV = bounds.radius / Math.sin(vFov / 2)
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
    const distH = bounds.radius / Math.sin(hFov / 2)
    const dist = Math.max(distV, distH) * 1.15

    cam.position.set(cx, cy, cz + dist)
    cam.near = Math.max(dist / 500, 0.01)
    cam.far = dist * 10
    cam.updateProjectionMatrix()
    framedFor.current = productId
  }, [productId, bounds, camera, size])

  return null
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
  product: Product
  placement: PinPlacement
  baseUrl: string
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
  product,
  placement,
  baseUrl,
}: PinCanvasProps) {
  const [bounds, setBounds] = useState<ProductBounds | null>(null)
  const showProduct = product.file !== null

  // Drop stale framing the moment the product changes. The rig waits for bounds before framing,
  // so without this it would measure the new product against the previous one's box and then
  // consider itself done.
  useEffect(() => {
    setBounds(null)
  }, [product.id])

  const handleBounds = useCallback((next: ProductBounds) => setBounds(next), [])

  const pin = (
    <PinMesh
      platingColor={platingColor}
      enamelType={enamelType}
      raisedHeight={raisedHeight}
      colorTexture={colorTexture}
      bumpTexture={bumpTexture}
      outline={outline}
      uv={uv}
      regions={regions}
      showPost={!showProduct}
    />
  )

  // Memoised so the array identity is stable across renders — a fresh array each time would have
  // drei re-applying the orbit target continuously.
  const target = useMemo<[number, number, number]>(
    () => (bounds ? bounds.center : [0, 0, 0]),
    [bounds],
  )
  const orbitLimits = bounds
    ? { min: bounds.radius * 0.6, max: bounds.radius * 8 }
    : { min: 2.4, max: 7 }

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={CAMERA_PROPS}
      gl={GL_PROPS}
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

      <Suspense
        fallback={
          <Html center>
            <div className="text-sm text-white/60 whitespace-nowrap">Loading model…</div>
          </Html>
        }
      >
        {showProduct ? (
          <ProductScene
            key={product.id}
            url={baseUrl + product.file}
            pinDiameter={placement.diameterMm / MM_PER_WORLD_UNIT}
            pinRotationDeg={[placement.pitchDeg, placement.yawDeg, placement.rollDeg]}
            onBounds={handleBounds}
          >
            {pin}
          </ProductScene>
        ) : (
          pin
        )}
      </Suspense>

      {!showProduct && (
        <ContactShadows
          position={[0, -0.9, 0]}
          opacity={0.55}
          scale={6}
          blur={2.6}
          far={2}
          resolution={1024}
        />
      )}

      <CameraRig bounds={showProduct ? bounds : null} productId={product.id} />

      <OrbitControls
        makeDefault
        target={target}
        enablePan={false}
        minDistance={orbitLimits.min}
        maxDistance={orbitLimits.max}
        minPolarAngle={Math.PI / 4}
        maxPolarAngle={Math.PI - Math.PI / 4}
      />
    </Canvas>
  )
}
