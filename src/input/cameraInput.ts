/**
 * Camera input — DOM glue (T-005 R5) that wires the pure pieces to the camera
 * store. All camera math goes through `view/camera` functions (I-02); this
 * file does no arithmetic on camera fields itself.
 *
 * Wheel, keyboard and pointer events are translated into `panBy` /
 * `zoomByFactorAt` / `zoomAt` calls on the current camera, and the result is
 * pushed into the store. The store then triggers a re-render and HUD update.
 */

import type { Point } from '../core/geometry';
import { isEditableTarget, zoomKeyAction } from './keys';
import {
  cursorFor,
  initialPanState,
  reduce as reducePan,
  type PanState,
} from './panController';
import { pointerToCanvasPos } from './cursor';
import { wheelDeltaToPixels, wheelToZoomFactor } from './wheel';
import type { CameraStore } from '../view/cameraStore';
import {
  panBy,
  zoomAt,
  zoomByFactorAt,
} from '../view/camera';

export interface CameraInputOptions {
  canvas: HTMLCanvasElement;
  store: CameraStore;
  /** Returns the current viewport size in CSS px (for keyboard zoom center). */
  getViewportSize(): { width: number; height: number };
}

export interface CameraInput {
  detach(): void;
}

/**
 * Attach camera input listeners (wheel, keyboard, pointer, blur). Returns a
 * `detach()` function that removes every listener and releases pointer capture.
 */
export function attachCameraInput(
  opts: CameraInputOptions,
): CameraInput {
  const { canvas, store, getViewportSize } = opts;

  let panState: PanState = initialPanState();
  let activePointerId: number | null = null;

  function applyCursor(): void {
    canvas.style.cursor = cursorFor(panState);
  }

  // ── Wheel ──────────────────────────────────────────────────────────────
  // passive:false so we can preventDefault (R5). Always preventDefault so the
  // page never scrolls while the canvas is focused.
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const cam = store.get();
    if (e.ctrlKey || e.metaKey) {
      const cursorScreen = pointerToCanvasPos(canvas, e.clientX, e.clientY);
      const factor = wheelToZoomFactor(e.deltaY, e.deltaMode);
      store.set(zoomByFactorAt(cam, cursorScreen, factor));
    } else {
      const dxPx = wheelDeltaToPixels(e.deltaX, e.deltaMode);
      const dyPx = wheelDeltaToPixels(e.deltaY, e.deltaMode);
      // Content follows the wheel: pan by −dx so dragging the wheel down
      // moves the content up (natural scrolling for pan).
      store.set(panBy(cam, -dxPx, -dyPx));
    }
  }

  // ── Keyboard ───────────────────────────────────────────────────────────
  function onKeyDown(e: KeyboardEvent): void {
    // Space feeds the pan controller (ignore auto-repeat).
    if (e.code === 'Space') {
      if (e.repeat) return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      const r = reducePan(panState, { type: 'spaceDown' });
      panState = r.state;
      applyCursor();
      return;
    }

    // Zoom keys.
    if (isEditableTarget(e.target)) return;
    const action = zoomKeyAction({
      key: e.key,
      code: e.code,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
    });
    if (action === null) return;

    e.preventDefault();
    const cam = store.get();
    const { width, height } = getViewportSize();
    const center: Point = { x: width / 2, y: height / 2 };

    if (action.type === 'factor') {
      store.set(zoomByFactorAt(cam, center, action.factor));
    } else {
      store.set(zoomAt(cam, center, 1));
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      const r = reducePan(panState, { type: 'spaceUp' });
      panState = r.state;
      applyCursor();
    }
  }

  // ── Pointer (panning) ─────────────────────────────────────────────────
  function onPointerDown(e: PointerEvent): void {
    // Ignore touch for now (T-005 out of scope).
    if (e.pointerType === 'touch') return;

    // For middle button, preventDefault on mousedown so the browser's
    // autoscroll never starts. We listen on pointerdown but also call
    // preventDefault to cover browsers that fire mousedown after.
    if (e.button === 1) {
      e.preventDefault();
    }

    const pos = pointerToCanvasPos(canvas, e.clientX, e.clientY);
    const r = reducePan(panState, {
      type: 'pointerDown',
      button: e.button,
      pointerId: e.pointerId,
      pos,
    });
    panState = r.state;
    if (panState.mode === 'panning') {
      activePointerId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
    }
    applyCursor();
  }

  function onPointerMove(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    const pos = pointerToCanvasPos(canvas, e.clientX, e.clientY);
    const r = reducePan(panState, {
      type: 'pointerMove',
      pointerId: e.pointerId,
      pos,
    });
    panState = r.state;
    if (r.pan) {
      const cam = store.get();
      store.set(panBy(cam, r.pan.dx, r.pan.dy));
    }
    applyCursor();
  }

  function onPointerUp(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    const r = reducePan(panState, {
      type: 'pointerUp',
      pointerId: e.pointerId,
    });
    panState = r.state;
    if (r.state.mode === 'idle' && activePointerId !== null) {
      try {
        canvas.releasePointerCapture(activePointerId);
      } catch {
        // Pointer capture may already be released; ignore.
      }
      activePointerId = null;
    }
    applyCursor();
  }

  function onPointerCancel(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    const r = reducePan(panState, {
      type: 'pointerCancel',
      pointerId: e.pointerId,
    });
    panState = r.state;
    if (activePointerId !== null) {
      try {
        canvas.releasePointerCapture(activePointerId);
      } catch {
        // Ignore.
      }
      activePointerId = null;
    }
    applyCursor();
  }

  // ── Blur (reset everything) ───────────────────────────────────────────
  function onBlur(): void {
    const r = reducePan(panState, { type: 'blur' });
    panState = r.state;
    activePointerId = null;
    applyCursor();
  }

  // Attach. Wheel is passive:false so preventDefault works.
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  // Also handle mousedown for middle button to suppress autoscroll in
  // browsers that fire it before pointerdown.
  function onMouseDown(e: MouseEvent): void {
    if (e.button === 1) e.preventDefault();
  }
  canvas.addEventListener('mousedown', onMouseDown);

  // Set the initial cursor.
  applyCursor();

  return {
    detach() {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
