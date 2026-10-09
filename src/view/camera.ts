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

import type { Point, Rect } from '../core/geometry';

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

/**
 * Zoom to `newZoom` (clamped into [MIN_ZOOM, MAX_ZOOM]) while keeping the
 * world point under `screenPoint` fixed — the anchor (PLAN D-08). The result
 * satisfies worldToScreen(result, screenToWorld(cam, screenPoint)) =
 * screenPoint. Non-finite camera, point or zoom input is a no-op: the camera
 * comes back unchanged, never NaN.
 */
export function zoomAt(
  cam: Camera,
  screenPoint: Point,
  newZoom: number,
): Camera {
  if (
    !isUsableCamera(cam) ||
    !Number.isFinite(screenPoint.x) ||
    !Number.isFinite(screenPoint.y) ||
    !Number.isFinite(newZoom)
  ) {
    return cam;
  }
  const z = clampZoom(newZoom);
  const w = screenToWorld(cam, screenPoint);
  return {
    x: w.x - screenPoint.x / z,
    y: w.y - screenPoint.y / z,
    zoom: z,
  };
}

/**
 * Zoom by a multiplicative factor at `screenPoint`. `factor` must be finite
 * and greater than 0; anything else is a no-op (camera unchanged, no NaN).
 */
export function zoomByFactorAt(
  cam: Camera,
  screenPoint: Point,
  factor: number,
): Camera {
  if (!Number.isFinite(factor) || factor <= 0) {
    return cam;
  }
  return zoomAt(cam, screenPoint, cam.zoom * factor);
}

/**
 * The world-space rectangle visible in a viewport of `width` × `height`
 * CSS pixels: its top-left corner is the camera's (x, y) — the world point
 * at the viewport's top-left — and its size is the viewport size divided
 * by the zoom.
 */
export function visibleWorldRect(
  cam: Camera,
  width: number,
  height: number,
): Rect {
  return { x: cam.x, y: cam.y, w: width / cam.zoom, h: height / cam.zoom };
}
