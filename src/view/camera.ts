/**
 * Camera — the single place where screen↔world conversion lives (I-02).
 *
 * Convention (PLAN D-07):
 *   - 1 world unit = 1 CSS px at zoom 1; every value here is CSS pixels,
 *     never device pixels.
 *   - `(x, y)` is the world point at the viewport's top-left corner.
 *   - screen = (world − cam) × zoom
 *   - world  = screen / zoom + cam
 *
 * Worked example: cam = { x: 100, y: 50, zoom: 2 }, world = { x: 110, y: 60 }
 *   screen = ((110 − 100) × 2, (60 − 50) × 2) = (20, 20)
 *
 * All functions are pure (PLAN D-18): they return new objects, never mutate
 * their input, and treat non-finite numeric input as a no-op — the camera
 * comes back unchanged. devicePixelRatio is handled only in the canvas host.
 */

import type { Point } from '../core/geometry';

export type Camera = { x: number; y: number; zoom: number };

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
export const DEFAULT_CAMERA: Camera = Object.freeze({ x: 0, y: 0, zoom: 1 });

/** Clamp a zoom level into [MIN_ZOOM, MAX_ZOOM]. Input is assumed finite. */
export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** screen = (world − cam) × zoom, on each axis. */
export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/** world = screen / zoom + cam, on each axis. */
export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

/**
 * True only for a usable camera: finite fields and a positive zoom.
 * Backs the no-op rule (D-18) so camera math can never produce NaN.
 */
function isUsableCamera(cam: Camera): boolean {
  return (
    Number.isFinite(cam.x) &&
    Number.isFinite(cam.y) &&
    Number.isFinite(cam.zoom) &&
    cam.zoom > 0
  );
}

/**
 * Pan by a pointer delta given in screen pixels: the content follows the
 * pointer, so the camera moves by −d / zoom. Zoom is unchanged. Non-finite
 * deltas are a no-op — the camera comes back unchanged, never NaN.
 */
export function panBy(
  cam: Camera,
  dxScreen: number,
  dyScreen: number,
): Camera {
  if (
    !isUsableCamera(cam) ||
    !Number.isFinite(dxScreen) ||
    !Number.isFinite(dyScreen)
  ) {
    return cam;
  }
  return {
    x: cam.x - dxScreen / cam.zoom,
    y: cam.y - dyScreen / cam.zoom,
    zoom: cam.zoom,
  };
}
