import { useMemo } from 'react'
import { ExtrudeGeometry, Path, Shape, Vector2, type CanvasTexture } from 'three'
import { ensureWinding, insetPolygon, type UVTransform } from '../lib/contour'
import { makeUVGenerator } from '../lib/uvGenerator'
import type { RegionPiece } from '../hooks/useTracedDesign'
import type { EnamelType } from '../types'

interface PinMeshProps {
  platingColor: string
  enamelType: EnamelType
  raisedHeight: number
  /** 0 (brushed/matte) to 1 (mirror-polished) for the plating — body, backing, plate, filler
   * and post all share this, since they're the same physical metal. */
  metalReflectivity: number
  /** 0 (satin) to 1 (glossy) for the enamel fill — the segmented color pieces and the fallback
   * textured face both share this, since they render the same conceptual surface. */
  enamelReflectivity: number
  colorTexture: CanvasTexture | null
  bumpTexture: CanvasTexture | null
  outline: Vector2[] | null
  uv: UVTransform | null
  regions: RegionPiece[] | null
  /** The stroke-bounded wells the regions sit in — one plate cavity each, base-coated in the
   * well's own dominant color. */
  cells: RegionPiece[] | null
  /** Strokes enclosed by the fill regions. They're part of the same metal plate, but can't be
   * expressed as holes in it — a hole would be enamel. They're extruded alongside it instead. */
  islands: Vector2[][] | null
  /** Hidden when the pin sits on a product — the post would otherwise pierce thin fabric geometry
   * and show through the back. */
  showPost?: boolean
  /** Dev aid: renders every material as a wireframe instead of shaded, so the underlying
   * geometry — plate cavities, fill layering, the ring's hole — can be inspected directly. */
  wireframe?: boolean
}

const RADIUS = 1
const BODY_THICKNESS = 0.1
const BODY_BEVEL = 0.02
const FACE_INSET = 0.94

const PLATE_FRONT_Z = BODY_THICKNESS / 2 + BODY_BEVEL + 0.015

// The body is a ring (hole = the plate's footprint) rather than a solid disc, so its front
// face never occludes the recessed fill. A separate flat backing seals the ring from behind,
// well clear of any recess depth we'd realistically want.
const RING_BACK_Z = -(BODY_THICKNESS / 2 + BODY_BEVEL)
const BACKING_THICKNESS = 0.03

const FILL_THICKNESS = 0.02
const FLUSH_EPS = 0.0015

// The enamel piece and the plate's cavity are cut from the same polygon, so without this the
// enamel's outer wall would be exactly coplanar with the cavity wall — the depth buffer can't
// order coplanar faces, which is what made the raised sides flicker and read as transparent.
//
// The clearance is taken out of the cavity rather than the enamel: shrinking each enamel piece
// instead left a gap between any two that sat side by side in one well, and the plating behind
// showed through it as a hairline crack across what should be an unbroken color transition.
// Widening the cavity keeps neighbouring pieces flush and takes the slack out of the stroke,
// which has material to spare.
const FILL_WALL_GAP = 0.004

// Separation between a well's base coat and the color areas drawn over it. Just enough for the
// depth buffer to order the two reliably, and far less than the shallowest recess (0.002), so
// the top layer never breaches the plate's front face.
const FILL_LAYER_GAP = 0.0004

export const MIN_RAISED_HEIGHT = 0.002
// Not a hard physical limit — a practical ceiling so the raised wall doesn't grow taller than
// the pin itself looks plausible.
export const MAX_RAISED_HEIGHT = 0.05
export const DEFAULT_RAISED_HEIGHT = 0.02

// Metal reflectivity is exposed as a single 0..1 "how mirror-like" knob and mapped onto
// roughness, the physical parameter that actually controls reflection sharpness. Range picked so
// 0 still reads as brushed metal (not chalk) and 1 as a genuine mirror finish.
const METAL_ROUGHNESS_MAX = 0.9
const METAL_ROUGHNESS_MIN = 0.05
// Reverse-engineered so the default reproduces the roughness=0.28 this shipped with, so turning
// the feature on doesn't shift anyone's existing look.
export const DEFAULT_METAL_REFLECTIVITY = (METAL_ROUGHNESS_MAX - 0.28) / (METAL_ROUGHNESS_MAX - METAL_ROUGHNESS_MIN)

function metalRoughness(reflectivity: number): number {
  return METAL_ROUGHNESS_MAX - reflectivity * (METAL_ROUGHNESS_MAX - METAL_ROUGHNESS_MIN)
}

// Enamel reflectivity maps to three meshPhysicalMaterial parameters at once: the clearcoat
// layer's strength and sharpness, plus the base coat's own roughness underneath it. Range chosen
// so 0 reads as a satin/soft-touch finish and 1 as a glossy, wet-look coating.
const ENAMEL_CLEARCOAT_ROUGHNESS_MAX = 0.75
const ENAMEL_CLEARCOAT_ROUGHNESS_MIN = 0.05
const ENAMEL_BASE_ROUGHNESS_MAX = 0.7
const ENAMEL_BASE_ROUGHNESS_MIN = 0.3
// Reproduces the clearcoat=0.5 / clearcoatRoughness=0.4 / roughness=0.5 this shipped with.
export const DEFAULT_ENAMEL_REFLECTIVITY = 0.5

function enamelMaterialParams(reflectivity: number) {
  return {
    clearcoat: reflectivity,
    clearcoatRoughness:
      ENAMEL_CLEARCOAT_ROUGHNESS_MAX -
      reflectivity * (ENAMEL_CLEARCOAT_ROUGHNESS_MAX - ENAMEL_CLEARCOAT_ROUGHNESS_MIN),
    roughness:
      ENAMEL_BASE_ROUGHNESS_MAX - reflectivity * (ENAMEL_BASE_ROUGHNESS_MAX - ENAMEL_BASE_ROUGHNESS_MIN),
  }
}

// The plate only needs to be deep enough to hold the deepest possible recess — its per-region
// holes cut all the way through whatever thickness it has, so making it deeper than necessary
// just turns those holes into long dark tunnels behind the fill. A separate, hole-free filler
// block (below) handles connecting it solidly back to the ring instead.
const PLATE_THICKNESS = MAX_RAISED_HEIGHT + FILL_THICKNESS + 0.01

// Fills the ring's hole behind the plate, solid (no per-region holes needed — nothing sits
// back there), all the way to (and slightly past) the ring's own back.
const FILLER_FRONT_Z = PLATE_FRONT_Z - PLATE_THICKNESS
const FILLER_THICKNESS = FILLER_FRONT_Z - RING_BACK_Z + 0.01

// Fallback face (no holes, so no tunnel risk) can just be one solid piece spanning the whole
// ring hole depth.
const FACE_SOLID_THICKNESS = PLATE_FRONT_Z - RING_BACK_Z + 0.01

type Pt2 = { x: number; y: number }

function tracePath<T extends Path>(path: T, points: Pt2[], scale: number): T {
  path.moveTo(points[0].x * scale, points[0].y * scale)
  for (let i = 1; i < points.length; i++) {
    path.lineTo(points[i].x * scale, points[i].y * scale)
  }
  path.closePath()
  return path
}

// ExtrudeGeometry wants the outer contour clockwise and holes counter-clockwise, but it only
// normalises hole winding inside the branch that fires when the outer contour ISN'T already
// clockwise. Traced outlines often come out clockwise already, so that branch is skipped and
// holes keep the outer contour's winding — which builds every cavity's side wall inside-out.
// Setting both windings explicitly here removes the dependency on that branch.
function pathFromPoints(points: Pt2[], scale: number): Path {
  return tracePath(new Path(), ensureWinding(points, false), scale)
}

function buildShape(points: Pt2[] | null, scale: number): Shape {
  if (points && points.length >= 3) {
    return tracePath(new Shape(), ensureWinding(points, true), scale)
  }
  const shape = new Shape()
  shape.absarc(0, 0, RADIUS * scale, 0, Math.PI * 2, true)
  return shape
}

/** The plate shape with a cavity cut out for every well, so recessed/flush fill shows through. */
function buildPlateShape(outline: Pt2[] | null, cells: RegionPiece[], scale: number): Shape {
  const shape = buildShape(outline, scale)
  for (const cell of cells) {
    if (cell.points.length < 3) continue
    // Outward offset: the cavity has to clear the enamel that fills it (see FILL_WALL_GAP).
    shape.holes.push(pathFromPoints(insetPolygon(cell.points, -FILL_WALL_GAP), scale))
  }
  return shape
}

function buildHolePath(points: Pt2[] | null, scale: number): Path {
  if (points && points.length >= 3) return pathFromPoints(points, scale)
  const path = new Path()
  path.absarc(0, 0, RADIUS * scale, 0, Math.PI * 2, false)
  return path
}

/** The body as a ring: outer boundary minus the plate's footprint, so its front face never occludes it. */
function buildRingShape(outline: Pt2[] | null, innerScale: number): Shape {
  const shape = buildShape(outline, 1)
  shape.holes.push(buildHolePath(outline, innerScale))
  return shape
}

/** Extrudes a flat (uncentered) piece from local z=0..depth, so its front face lands at frontZ. */
function buildFlatGeometry(
  shape: Shape | Shape[],
  depth: number,
  frontZ: number,
  curveSegments: number,
  uvGenerator?: ReturnType<typeof makeUVGenerator>,
) {
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments,
    ...(uvGenerator ? { UVGenerator: uvGenerator } : {}),
  })
  geometry.translate(0, 0, frontZ - depth)
  return geometry
}

export function PinMesh({
  platingColor,
  enamelType,
  raisedHeight,
  metalReflectivity,
  enamelReflectivity,
  colorTexture,
  bumpTexture,
  outline,
  uv,
  regions,
  cells,
  islands,
  showPost = true,
  wireframe = false,
}: PinMeshProps) {
  const curveSegments = outline ? 1 : 64
  // Both halves are required: the cells cut the plate's cavities and the regions fill them, so
  // either one missing would render a solid plate over the artwork or cavities with nothing in
  // them. Falling back to the textured face is the honest result in that case.
  const hasRegions = !!regions && regions.length > 0 && !!cells && cells.length > 0
  const roughness = metalRoughness(metalReflectivity)
  const enamel = enamelMaterialParams(enamelReflectivity)

  const bodyGeometry = useMemo(() => {
    const shape = buildRingShape(outline, FACE_INSET)
    const geometry = new ExtrudeGeometry(shape, {
      depth: BODY_THICKNESS,
      bevelEnabled: true,
      bevelThickness: BODY_BEVEL,
      bevelSize: BODY_BEVEL,
      bevelSegments: 4,
      curveSegments,
    })
    geometry.center()
    return geometry
  }, [outline, curveSegments])

  const backingGeometry = useMemo(() => {
    const shape = buildShape(outline, 1)
    return buildFlatGeometry(shape, BACKING_THICKNESS, RING_BACK_Z, curveSegments)
  }, [outline, curveSegments])

  // Fallback (no line-art detected): single textured face, filling the ring's hole solidly.
  // No holes here, so no tunnel risk — safe to make it span the whole depth in one piece.
  const faceGeometry = useMemo(() => {
    const shape = buildShape(outline, FACE_INSET)
    const uvGenerator = makeUVGenerator(uv)
    return buildFlatGeometry(shape, FACE_SOLID_THICKNESS, PLATE_FRONT_Z, curveSegments, uvGenerator)
  }, [outline, uv, curveSegments])

  // Segmented mode: a shallow metal plate (just deep enough for the recess) plus one piece per
  // color region, backed by a solid hole-free filler that connects the plate to the ring/backing.
  const plateGeometry = useMemo(() => {
    if (!hasRegions || !cells) return null
    const shape = buildPlateShape(outline, cells, FACE_INSET)
    // Islands sit inside the plate's own holes, so they extrude as sibling contours of the same
    // slab rather than as part of its outline — same material, same depth, one geometry.
    const islandShapes = (islands ?? [])
      .filter((points) => points.length >= 3)
      .map((points) => tracePath(new Shape(), ensureWinding(points, true), FACE_INSET))

    return buildFlatGeometry(
      [shape, ...islandShapes],
      PLATE_THICKNESS,
      PLATE_FRONT_Z,
      curveSegments,
    )
  }, [hasRegions, cells, islands, outline, curveSegments])

  const fillerGeometry = useMemo(() => {
    if (!hasRegions) return null
    const shape = buildShape(outline, FACE_INSET)
    return buildFlatGeometry(shape, FILLER_THICKNESS, FILLER_FRONT_Z, curveSegments)
  }, [hasRegions, outline, curveSegments])

  const fillFrontZ =
    enamelType === 'soft' ? PLATE_FRONT_Z - raisedHeight : PLATE_FRONT_Z - FLUSH_EPS

  // Two layers, both at the traced boundary with no shrink, so pieces sharing an edge inside a
  // well stay flush: the well's base coat, then its color areas a hair in front of it. Anywhere
  // the color areas don't quite meet, the base coat shows rather than the plate.
  const fillPieces = useMemo(() => {
    if (!hasRegions) return []
    const build = (piece: RegionPiece, frontZ: number) => ({
      geometry: buildFlatGeometry(buildShape(piece.points, FACE_INSET), FILL_THICKNESS, frontZ, 1),
      color: piece.color,
    })
    return [
      ...(cells ?? []).map((cell) => build(cell, fillFrontZ)),
      ...(regions ?? []).map((region) => build(region, fillFrontZ + FILL_LAYER_GAP)),
    ]
  }, [hasRegions, cells, regions, fillFrontZ])

  return (
    <group>
      {/* Metal body / border (a ring, so it never occludes the recessed fill) */}
      <mesh geometry={bodyGeometry} castShadow receiveShadow>
        <meshStandardMaterial
          color={platingColor}
          metalness={1}
          roughness={roughness}
          envMapIntensity={1.25}
          wireframe={wireframe}
        />
      </mesh>

      {/* Backing plate: seals the body ring from behind */}
      <mesh geometry={backingGeometry} receiveShadow>
        <meshStandardMaterial
          color={platingColor}
          metalness={1}
          roughness={roughness}
          envMapIntensity={1.25}
          wireframe={wireframe}
        />
      </mesh>

      {hasRegions ? (
        <>
          <mesh geometry={plateGeometry!} castShadow receiveShadow>
            <meshStandardMaterial
              color={platingColor}
              metalness={1}
              roughness={roughness}
              envMapIntensity={1.25}
              wireframe={wireframe}
            />
          </mesh>
          <mesh geometry={fillerGeometry!} receiveShadow>
            <meshStandardMaterial
              color={platingColor}
              metalness={1}
              roughness={roughness}
              envMapIntensity={1.25}
              wireframe={wireframe}
            />
          </mesh>
          {fillPieces.map((piece, i) => (
            <mesh key={i} geometry={piece.geometry} castShadow>
              <meshPhysicalMaterial
                color={piece.color}
                roughness={enamel.roughness}
                clearcoat={enamel.clearcoat}
                clearcoatRoughness={enamel.clearcoatRoughness}
                metalness={0}
                envMapIntensity={0.35}
                wireframe={wireframe}
              />
            </mesh>
          ))}
        </>
      ) : (
        <mesh geometry={faceGeometry} castShadow>
          {colorTexture ? (
            <meshPhysicalMaterial
              map={colorTexture}
              bumpMap={bumpTexture ?? undefined}
              bumpScale={bumpTexture ? 0.015 : 0}
              roughness={enamel.roughness}
              clearcoat={enamel.clearcoat}
              clearcoatRoughness={enamel.clearcoatRoughness}
              metalness={0}
              envMapIntensity={0.35}
              wireframe={wireframe}
            />
          ) : (
            <meshStandardMaterial color="#3a3a3f" roughness={0.6} wireframe={wireframe} />
          )}
        </mesh>
      )}

      {/* Pin post (back hardware, purely decorative) */}
      {showPost && (
        <mesh position={[0.3, 0, -(BODY_THICKNESS / 2 + 0.25)]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.5, 16]} />
          <meshStandardMaterial
            color="#c7c9cc"
            metalness={1}
            roughness={roughness}
            envMapIntensity={1.1}
            wireframe={wireframe}
          />
        </mesh>
      )}
    </group>
  )
}
