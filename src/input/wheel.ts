/**
 * Wheel delta normalization (T-005 R2) — pure, DOM-free (PLAN D-06, R7).
 *
 * Converts a `WheelEvent`'s `deltaY` + `deltaMode` pair into a consistent
 * pixel value, and derives a zoom factor from it. No DOM access — just
 * arithmetic on the numbers the DOM glue passes in.
 */

/** Multiplier applied per deltaMode (R2). */
const LINES_TO_PX = 16;
const PAGES_TO_PX = 400;

/**
 * Sensitivity for the zoom factor: `exp(−px × SENSITIVITY)` (R2).
 * Exported so tests and callers can reference the same constant.
 */
export const ZOOM_SENSITIVITY = 0.002;

/** Clamping range for the zoom factor. */
const FACTOR_MIN = 0.5;
const FACTOR_MAX = 2;

/**
 * Convert a wheel delta to CSS pixels based on its `deltaMode`.
 *
 * - mode 0 (pixels) → ×1
 * - mode 1 (lines)  → ×16
 * - mode 2 (pages)  → ×400
 * - anything else   → ×1
 */
export function wheelDeltaToPixels(
  delta: number,
  deltaMode: number,
): number {
  if (deltaMode === 1) return delta * LINES_TO_PX;
  if (deltaMode === 2) return delta * PAGES_TO_PX;
  return delta;
}

/**
 * Derive a zoom factor from a wheel `deltaY` + `deltaMode`.
 *
 * `px = wheelDeltaToPixels(deltaY, deltaMode)`. Non-finite `px` → 1.
 * Otherwise `clamp(exp(−px × SENSITIVITY), FACTOR_MIN, FACTOR_MAX)`.
 *
 * A negative `deltaY` (scroll up / zoom in) yields a factor > 1; a positive
 * `deltaY` (scroll down / zoom out) yields a factor < 1.
 */
export function wheelToZoomFactor(
  deltaY: number,
  deltaMode: number,
): number {
  const px = wheelDeltaToPixels(deltaY, deltaMode);
  if (!Number.isFinite(px)) return 1;
  const f = Math.exp(-px * ZOOM_SENSITIVITY);
  return Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, f));
}
