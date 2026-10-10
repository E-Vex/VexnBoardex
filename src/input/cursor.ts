/**
 * Cursor tracker (T-004 R5) — listens to `pointermove` and `pointerleave` on
 * the canvas and reports the cursor position in CSS pixels relative to the
 * canvas. Uses `getBoundingClientRect` (not `offsetX`) for cross-browser
 * correctness. Reports `null` on leave. Does nothing else.
 */

import type { Point } from '../core/geometry';

export interface CursorTracker {
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
  function onPointerMove(e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    onMove({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  function onPointerLeave(): void {
    onMove(null);
  }

  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);

  return {
    destroy() {
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
    },
  };
}
