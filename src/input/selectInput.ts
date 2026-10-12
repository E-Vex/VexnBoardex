/**
 * Select input (T-008 R6) — DOM glue for the select tool state machine
 * (`selectTool.ts`). Converts pointer and keyboard events into machine
 * events and applies the emitted effects:
 *
 * - `select`  → `uiStore.setSelection`
 * - `setDrag` → `uiStore.setDrag`
 * - `dispatch`→ `docStore.dispatch` (I-03: the only mutation path)
 *
 * Coordinate conversion goes through `view/camera` (I-02) and the shared
 * position helper; hit-testing through `core/hitTest`. Nothing starts while
 * a pan owns the pointer (`isPanActive`: Space held or actively panning —
 * D-26) or for touch pointers. Pointer capture is held only while a gesture
 * on a node is active.
 *
 * Delete/Backspace arrive via `keydown` on `window`: ignored for editable
 * targets and (per D-27) with modifier keys held; `Backspace` always
 * `preventDefault`s when the app owns it, so the browser never navigates
 * back.
 */

import { hitTest } from '../core/hitTest';
import type { DocStore } from '../core/store';
import { screenToWorld } from '../view/camera';
import type { CameraStore } from '../view/cameraStore';
import type { UiStore } from '../view/uiStore';
import { isEditableTarget } from './keys';
import { pointerToCanvasPos } from './cursor';
import {
  type SelectCtx,
  type SelectEffect,
  type SelectEvent,
  type SelectState,
  initialSelectState,
  reduce,
} from './selectTool';

export interface SelectInputOptions {
  canvas: HTMLCanvasElement;
  cameraStore: CameraStore;
  docStore: DocStore;
  uiStore: UiStore;
  /** True while a pan gesture owns the pointer (Space held or panning). */
  isPanActive(): boolean;
}

export interface SelectInput {
  detach(): void;
}

/**
 * Attach select/move/delete input. Returns a `detach()` that removes every
 * listener and releases pointer capture.
 */
export function attachSelectInput(opts: SelectInputOptions): SelectInput {
  const { canvas, cameraStore, docStore, uiStore, isPanActive } = opts;

  let state: SelectState = initialSelectState();
  let capturedPointerId: number | null = null;

  /** Apply the machine's effects to the UI and doc stores (R6). */
  function applyEffects(effects: SelectEffect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case 'select':
          uiStore.setSelection(effect.ids);
          break;
        case 'setDrag':
          uiStore.setDrag(effect.drag);
          break;
        case 'dispatch':
          docStore.dispatch(effect.command);
          break;
      }
    }
  }

  /**
   * Hold pointer capture exactly while a gesture on a node is active, so
   * moves and the release keep arriving even outside the canvas (R6).
   */
  function syncPointerCapture(): void {
    const gesturePointer = state.mode !== 'idle' ? state.pointerId : null;
    if (gesturePointer !== null && capturedPointerId === null) {
      try {
        canvas.setPointerCapture(gesturePointer);
        capturedPointerId = gesturePointer;
      } catch {
        // The pointer may already be gone; the gesture still works without
        // capture as long as the pointer stays over the canvas.
      }
    } else if (gesturePointer === null && capturedPointerId !== null) {
      try {
        canvas.releasePointerCapture(capturedPointerId);
      } catch {
        // Capture may already be released (e.g. after pointerup).
      }
      capturedPointerId = null;
    }
  }

  /** The machine context: the selection as of this event. */
  function currentCtx(): SelectCtx {
    return { selection: uiStore.get().selection };
  }

  /** Feed one event, apply its effects, sync capture. */
  function feed(event: SelectEvent): void {
    const result = reduce(state, event, currentCtx());
    state = result.state;
    applyEffects(result.effects);
    syncPointerCapture();
  }

  /** Screen (CSS px, canvas-relative) and world position of an event. */
  function positions(e: PointerEvent): {
    screen: { x: number; y: number };
    world: { x: number; y: number };
  } {
    const screen = pointerToCanvasPos(canvas, e.clientX, e.clientY);
    const world = screenToWorld(cameraStore.get(), screen);
    return { screen, world };
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'touch') return; // touch is out of scope
    if (isPanActive()) return; // Space+left and middle belong to panning
    const { screen, world } = positions(e);
    const hitId = hitTest(docStore.get(), world);
    feed({
      type: 'pointerDown',
      button: e.button,
      pointerId: e.pointerId,
      screen,
      world,
      hitId,
    });
  }

  function onPointerMove(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    if (state.mode === 'idle') return; // no gesture → nothing to update
    const { screen, world } = positions(e);
    feed({ type: 'pointerMove', pointerId: e.pointerId, screen, world });
  }

  function onPointerUp(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    if (state.mode === 'idle') return; // nobody is pressed on a node
    const { screen, world } = positions(e);
    feed({ type: 'pointerUp', pointerId: e.pointerId, screen, world });
  }

  function onPointerCancel(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    feed({ type: 'pointerCancel', pointerId: e.pointerId });
  }

  function onKeyDown(e: KeyboardEvent): void {
    const key = e.key;
    if (key !== 'Escape' && key !== 'Delete' && key !== 'Backspace') return;
    if (isEditableTarget(e.target)) return; // D-27: never steal typing
    if (
      (key === 'Delete' || key === 'Backspace') &&
      (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)
    ) {
      return; // D-27: not with modifier keys
    }
    if (key === 'Backspace') e.preventDefault(); // never navigate back
    feed({ type: 'key', key });
  }

  function onBlur(): void {
    feed({ type: 'blur' });
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('blur', onBlur);

  return {
    detach() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
      if (capturedPointerId !== null) {
        try {
          canvas.releasePointerCapture(capturedPointerId);
        } catch {
          // Ignore.
        }
        capturedPointerId = null;
      }
      state = initialSelectState();
    },
  };
}
