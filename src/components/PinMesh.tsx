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
/** Scale for the circular fallback face only — the design-less placeholder, which has no traced
 * outline to offset and still wants a visible metal border around it. Traced designs no longer
 * scale their interior; see `buildMetalShape`. */
const FACE_INSET = 0.94

// The top of every metal surface on the pin. There is only one such surface now — border,
// interior strokes and enclosed detail strokes are all contours of a single extrusion — so this
// is a height nothing can disagree with.
//
// Previously the metal was three separate pieces (a border ring, a plate inset by a synthetic
// border, and islands) whose boundaries were derived two different ways: the interior by a
// uniform scale about the origin, the plate's boundary by a miter offset following the outline.
// Those disagree near a concavity, and a cavity that crossed the boundary was silently DROPPED
// by ExtrudeGeometry's triangulator, filling that well in as solid metal at the plate's top
// level. Measured on the sample fish: 1 of 6 cavities. Deriving the border from the artwork
// instead of synthesising one removes the second boundary entirely, so there is nothing left to
// disagree.
const METAL_TOP_Z = BODY_THICKNESS / 2 + BODY_BEVEL

const BODY_BACK_Z = -(BODY_THICKNESS / 2 + BODY_BEVEL)
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

// Deep enough to hold the deepest recess we allow plus the fill sitting in it, and no deeper —
// the wells cut clean through whatever thickness the face has, so extra depth would just turn
// them into long dark tunnels. The body behind closes them off and forms their floor.
const METAL_THICKNESS = MAX_RAISED_HEIGHT + FILL_THICKNESS + 0.01

const BODY_FRONT_Z = METAL_TOP_Z - METAL_THICKNESS

// The body carries the pin's thickness and its rounded rim, and sits entirely behind the metal
// face. ExtrudeGeometry's bevel is widest at mid-depth and returns to the given contour at both
// ends, so a beveled body bulges OUT by `bevelSize` rather than chamfering in. Insetting its
// contour by exactly that much lands its widest point back on the outline, so it fills the face
// from behind without ever poking past it — a body that protruded would read as a second border
// sitting at a lower level, which is precisely what this structure exists to prevent.
const BODY_DEPTH = BODY_FRONT_Z - BODY_BACK_Z - 2 * BODY_BEVEL

// Fallback face (no wells, so no tunnel risk) is one solid piece spanning the whole depth.
const FACE_SOLID_THICKNESS = METAL_TOP_Z - BODY_BACK_Z + 0.01

type Pt2 = { x: number; y: number }

/** Scale to pair with a face contour. A traced outline is used as-is; the circular fallback has
 * no artwork to take a border from and still wants one, so it keeps the uniform inset. */
function faceScale(face: Pt2[] | null): number {
  return face ? 1 : FACE_INSET
}

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

/** Every piece of metal on the pin's face, as one shape: the silhouette itself, with a cavity cut
 * out for each enamel well.
 *
 * The border and the strokes between colour fields are not built — they are simply whatever metal
 * is left once the wells are removed, which is what a stamped pin actually is. That makes the
 * border the artwork's own outline stroke rather than a synthetic one, and it means no second
 * boundary exists that the wells could fail to agree with.
 *
 * Containment comes for free: `useTracedDesign` already clamps every region inside the silhouette,
 * so a well can never escape the contour it is cut from — the failure where a stray cavity got
 * silently dropped is unreachable by construction. */
function buildMetalShape(outline: Pt2[] | null, cells: RegionPiece[]): Shape {
  const shape = buildShape(outline, faceScale(outline))
  for (const cell of cells) {
    if (cell.points.length < 3) continue
    // Outward offset: the cavity has to clear the enamel that fills it (see FILL_WALL_GAP).
    shape.holes.push(pathFromPoints(insetPolygon(cell.points, -FILL_WALL_GAP), faceScale(outline)))
  }
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

/** Extrudes a beveled piece so its front face lands at frontZ. A beveled extrude spans
 * -bevelThickness .. depth + bevelThickness, hence the shifted translate. */
function buildBeveledGeometry(shape: Shape, depth: number, frontZ: number, curveSegments: number) {
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: BODY_BEVEL,
    bevelSize: BODY_BEVEL,
    bevelSegments: 4,
    curveSegments,
  })
  geometry.translate(0, 0, frontZ - (depth + BODY_BEVEL))
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

  // The pin's thickness and rounded rim, sitting wholly behind the metal face. Inset by the
  // bevel it bulges back out by, so it fills the face from behind without protruding past it.
  const bodyGeometry = useMemo(() => {
    const contour = outline ? insetPolygon(outline, BODY_BEVEL) : null
    const shape = buildShape(contour, contour ? 1 : FACE_INSET - BODY_BEVEL)
    return buildBeveledGeometry(shape, BODY_DEPTH, BODY_FRONT_Z, curveSegments)
  }, [outline, curveSegments])

  const backingGeometry = useMemo(() => {
    const contour = outline ? insetPolygon(outline, BODY_BEVEL) : null
    const shape = buildShape(contour, contour ? 1 : FACE_INSET - BODY_BEVEL)
    return buildFlatGeometry(shape, BACKING_THICKNESS, BODY_BACK_Z, curveSegments)
  }, [outline, curveSegments])

  // Fallback (no line-art detected): single textured face spanning the whole depth. No wells, so
  // no tunnel risk, and it keeps the uniform inset since there is no artwork border to inherit.
  const faceGeometry = useMemo(() => {
    const shape = buildShape(outline, faceScale(outline))
    const uvGenerator = makeUVGenerator(uv)
    return buildFlatGeometry(shape, FACE_SOLID_THICKNESS, METAL_TOP_Z, curveSegments, uvGenerator)
  }, [outline, uv, curveSegments])

  // Every metal surface on the face, as one extrusion: the silhouette with a well cut out per
  // colour area, plus any enclosed detail stroke as a sibling contour of the same slab. Sharing
  // one extrusion is what makes their heights identical by construction rather than by matching
  // constants — there is no second metal top left to drift.
  const metalGeometry = useMemo(() => {
    if (!hasRegions || !cells) return null
    const shape = buildMetalShape(outline, cells)
    const islandShapes = (islands ?? [])
      .filter((points) => points.length >= 3)
      .map((points) => tracePath(new Shape(), ensureWinding(points, true), faceScale(outline)))

    return buildFlatGeometry(
      [shape, ...islandShapes],
      METAL_THICKNESS,
      METAL_TOP_Z,
      curveSegments,
    )
  }, [hasRegions, cells, islands, outline, curveSegments])

  const fillFrontZ =
    enamelType === 'soft' ? METAL_TOP_Z - raisedHeight : METAL_TOP_Z - FLUSH_EPS

  // Two layers, both at the traced boundary with no shrink, so pieces sharing an edge inside a
  // well stay flush: the well's base coat, then its color areas a hair in front of it. Anywhere
  // the color areas don't quite meet, the base coat shows rather than the metal.
  //
  // These share the metal face's scale, which is what registers each piece with the well it sits
  // in. The two used to be scaled differently, and that mismatch is what let a well escape its
  // own plate.
  const fillPieces = useMemo(() => {
    if (!hasRegions) return []
    const scale = faceScale(outline)
    const build = (piece: RegionPiece, frontZ: number) => ({
      geometry: buildFlatGeometry(buildShape(piece.points, scale), FILL_THICKNESS, frontZ, 1),
      color: piece.color,
    })
    return [
      ...(cells ?? []).map((cell) => build(cell, fillFrontZ)),
      ...(regions ?? []).map((region) => build(region, fillFrontZ + FILL_LAYER_GAP)),
    ]
  }, [hasRegions, cells, regions, outline, fillFrontZ])

  return (
    <group>
      {/* Body: thickness and rounded rim, entirely behind the face and never past its edge.
          Also forms the floor of every well, since the wells cut clean through the face. */}
      <mesh geometry={bodyGeometry} castShadow receiveShadow>
        <meshStandardMaterial
          color={platingColor}
          metalness={1}
          roughness={roughness}
          envMapIntensity={1.25}
          wireframe={wireframe}
        />
      </mesh>

      {/* Backing plate: seals the body from behind */}
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
          {/* Border, colour-field strokes and enclosed detail strokes — one extrusion, so one
              height. */}
          <mesh geometry={metalGeometry!} castShadow receiveShadow>
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
