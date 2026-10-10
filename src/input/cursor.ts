/**
 * Cursor tracker (T-004 R5 / T-005 R5) — listens to `pointermove` and
 * `pointerleave` on the canvas and reports the cursor position in CSS pixels
 * relative to the canvas. Uses `getBoundingClientRect` (not `offsetX`) for
 * cross-browser correctness. Reports `null` on leave. Does nothing else.
 *
 * The position helper `pointerToCanvasPos` is exported so the camera input
 * glue (`cameraInput.ts`) can reuse the same conversion (T-005 R5).
 */

import type { Point } from '../core/geometry';

/**
 * Convert a client-space pointer position to CSS px relative to `canvas`.
 * Exported so the camera input glue can reuse the same conversion (R5).
 */
export function pointerToCanvasPos(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

export interface CursorTracker {
  /** The last reported cursor position (CSS px relative to the canvas), or null. */
  current(): Point | null;
  destroy(): void;
}

/**
 * Attach pointer listeners to `canvas`. `onMove` is called with the cursor
 * position (CSS px relative to the canvas) on `pointermove`, and `null` on
 * `pointerleave`.
 */
export function createCursorTracker(
  canvas: HTMLCanvasElement,
  onMove: (pos: Point | null) => void,
): CursorTracker {
  let current: Point | null = null;

  function onPointerMove(e: PointerEvent): void {
    current = pointerToCanvasPos(canvas, e.clientX, e.clientY);
    onMove(current);
  }

  function onPointerLeave(): void {
    current = null;
    onMove(null);
  }

  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);

  return {
    current() {
      return current;
    },
    destroy() {
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
    },
  };
}
