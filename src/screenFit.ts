// screenFit.ts — a rectangle measured on the camera feed, as a screen transform.
//
// A `ScreenShape` / `ScreenText` transform is resolved by the SDK with ONE
// uniform scale for position and size: min(viewportWidth / 720,
// viewportHeight / 1280) design pixels per viewport pixel
// (`resolveScreenTransform2D`). The SDK's `normalizedToScreenPixels` instead
// stretches each axis over the whole viewport. The two agree only at 9:16, so a
// box traced around a tracked face or hand through `normalizedToScreenPixels`
// drifts toward the centre and comes out narrow on any other canvas, such as
// the `full` frame on a desktop. This helper converts both the centre and the
// size from viewport pixels through the uniform scale, which is what the
// renderer undoes.
const ROOT_W = 720;
const ROOT_H = 1280;

export type FeedRect = { minX: number; minY: number; maxX: number; maxY: number };
export type ViewportSize = { width: number; height: number };

/** Uniform design-pixel → viewport-pixel scale of screen-space transforms. */
export const screenSizeScale = ({ width, height }: ViewportSize) =>
  Math.min(width / ROOT_W, height / ROOT_H);

/**
 * Centre and size, in design pixels, of a feed rectangle (0..1, top-left
 * origin) padded by `padding` design pixels on every side.
 */
export const feedRectToScreen = (
  rect: FeedRect,
  viewport: ViewportSize,
  padding = 0,
): { position: { x: number; y: number }; size: { width: number; height: number } } => {
  const scale = screenSizeScale(viewport);
  if (!(scale > 0)) return { position: { x: 0, y: 0 }, size: { width: 1, height: 1 } };
  const cx = ((rect.minX + rect.maxX) / 2 - 0.5) * viewport.width;
  const cy = (0.5 - (rect.minY + rect.maxY) / 2) * viewport.height;
  const widthPx = Math.abs(rect.maxX - rect.minX) * viewport.width;
  const heightPx = Math.abs(rect.maxY - rect.minY) * viewport.height;
  const pad = Math.max(0, padding) * 2;
  return {
    position: { x: cx / scale, y: cy / scale },
    size: {
      width: Math.max(1, widthPx / scale + pad),
      height: Math.max(1, heightPx / scale + pad),
    },
  };
};
