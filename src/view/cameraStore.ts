/**
 * Camera store (T-005 R1) — a tiny observable container for the camera.
 *
 * Pure and DOM-free (PLAN D-06, D-18, R7): no `window`, `document`, canvas
 * or DOM types. Only holds a `Camera` value, validates it, and notifies
 * subscribers when `x`, `y` or `zoom` actually change.
 *
 * Cameras are treated as immutable: `set` stores the new object as-is.
 */

import type { Camera } from './camera';

export interface CameraStore {
  /** Returns the current camera. */
  get(): Camera;
  /**
   * Replace the camera. A camera with a non-finite field or `zoom ≤ 0` is
   * ignored (the store keeps its previous value). Subscribers are notified
   * only when `x`, `y` or `zoom` actually changed.
   */
  set(cam: Camera): void;
  /** Subscribe to camera changes. Returns an unsubscribe function. */
  subscribe(fn: (cam: Camera) => void): () => void;
}

/** True only for a usable camera: finite fields and a positive zoom. */
function isUsableCamera(cam: Camera): boolean {
  return (
    Number.isFinite(cam.x) &&
    Number.isFinite(cam.y) &&
    Number.isFinite(cam.zoom) &&
    cam.zoom > 0
  );
}

/** True when two cameras have identical x, y and zoom. */
function camerasEqual(a: Camera, b: Camera): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

/**
 * Create a camera store initialised to `initial`.
 */
export function createCameraStore(initial: Camera): CameraStore {
  let current: Camera = initial;
  const subscribers = new Set<(cam: Camera) => void>();

  return {
    get() {
      return current;
    },
    set(cam: Camera) {
      if (!isUsableCamera(cam)) return;
      if (camerasEqual(cam, current)) return;
      current = cam;
      for (const fn of subscribers) {
        fn(current);
      }
    },
    subscribe(fn: (cam: Camera) => void): () => void {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
  };
}
