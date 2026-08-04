import { useEffect, useMemo, type ReactNode } from 'react'
import { useGLTF } from '@react-three/drei'
import { Box3, Object3D, Quaternion, Vector3 } from 'three'

/** Blender exports the placement empty under whatever name the artist gave it — these models use
 * "PinPosition", "Empty" and "Empty.001" — so match on a prefix rather than an exact name. */
const ANCHOR_PATTERN = /^(pinposition|empty)/i

function findAnchor(root: Object3D): Object3D | null {
  let found: Object3D | null = null
  root.traverse((child) => {
    if (!found && ANCHOR_PATTERN.test(child.name)) found = child
  })
  return found
}

export interface ProductBounds {
  center: [number, number, number]
  radius: number
}

interface ProductSceneProps {
  url: string
  /** Pin diameter in the model's world units. */
  pinDiameter: number
  /** Spin about the anchor's outward normal, in degrees. */
  pinRollDeg: number
  /** The pin, already built. Rendered into the anchor's frame. */
  children: ReactNode
  onBounds: (bounds: ProductBounds) => void
}

export function ProductScene({
  url,
  pinDiameter,
  pinRollDeg,
  children,
  onBounds,
}: ProductSceneProps) {
  const { scene } = useGLTF(url)

  // useGLTF caches by URL, so the same Object3D would otherwise be attached in two places if the
  // product is switched away and back. These models have no skins or animations, so a plain clone
  // is enough.
  const model = useMemo(() => scene.clone(true), [scene])

  const anchor = useMemo(() => {
    model.updateWorldMatrix(true, true)
    const node = findAnchor(model)
    if (!node) return null

    // Take only position and orientation. Any scale baked into the empty is the artist's business
    // and would otherwise stretch the pin.
    const position = new Vector3()
    const quaternion = new Quaternion()
    node.matrixWorld.decompose(position, quaternion, new Vector3())
    return { position, quaternion }
  }, [model])

  const bounds = useMemo(() => {
    const box = new Box3().setFromObject(model)
    const center = new Vector3()
    const size = new Vector3()
    box.getCenter(center)
    box.getSize(size)
    return {
      center: [center.x, center.y, center.z] as [number, number, number],
      radius: Math.max(size.x, size.y, size.z) / 2,
    }
  }, [model])

  useEffect(() => {
    onBounds(bounds)
  }, [bounds, onBounds])

  // Pin geometry is built at radius 1, so a unit of scale is 2 units of diameter.
  const pinScale = pinDiameter / 2

  return (
    <>
      <primitive object={model} />
      {anchor && (
        <group position={anchor.position} quaternion={anchor.quaternion}>
          {/* Nested inside the anchor's frame, so Z here is the surface normal and the roll
              spins the pin against the fabric rather than tilting it away from it. */}
          <group rotation={[0, 0, (pinRollDeg * Math.PI) / 180]} scale={pinScale}>
            {children}
          </group>
        </group>
      )}
    </>
  )
}
