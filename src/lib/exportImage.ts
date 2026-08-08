/** Saving a mockup out as a PNG file.
 *
 * The capture itself is deliberately a read of the live canvas rather than a re-render into an
 * offscreen target. An offscreen render target comes out linear unless its color space is set by
 * hand, and tone mapping is applied on the way to the default framebuffer — so the offscreen
 * route quietly produces a washed-out image that doesn't match the viewport. Reading the canvas
 * back guarantees the file is exactly the pin the user is looking at, ACES curve and all.
 */

/** Turns a design's filename and a product's label into something safe to write to disk. */
export function mockupFilename(designName: string | null, productLabel: string): string {
  const slug = (value: string) =>
    value
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

  const design = designName ? slug(designName) : 'enamel-pin'
  return `${design || 'enamel-pin'}-${slug(productLabel) || 'mockup'}.png`
}

/** Hands a blob to the browser as a download. The object URL is revoked on the next tick rather
 * than immediately — Firefox cancels an in-flight download if its URL is revoked synchronously. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Resolves after `count` painted frames. Switching product updates React state, which the camera
 * rig then reacts to; waiting on frames rather than a fixed delay ties the capture to work
 * actually having been drawn.
 *
 * The timer is a fallback, not a belt-and-braces duplicate: a backgrounded tab stops painting and
 * `requestAnimationFrame` stops firing with it, so a user who starts an export and switches away
 * would otherwise leave it stalled mid-run with the panel stuck reporting progress. Capturing
 * still works in that state — the capture forces its own render rather than relying on the
 * loop — so falling through on a timer produces the right image rather than no image. */
export function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = count
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    const tick = () => {
      remaining -= 1
      if (remaining <= 0) done()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    setTimeout(done, 60 * count + 250)
  })
}
