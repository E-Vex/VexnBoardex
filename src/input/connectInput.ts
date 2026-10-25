/**
 * Connect input (T-011 R3) — DOM glue for the connect tool state machine
 * (`connectTool.ts`). Converts pointer events into machine events and applies
 * the emitted effects:
 *
 * - `setConnect` → `uiStore.setConnect` (preview line from handle to cursor, T-018)
 * - `dispatch` → `docStore.dispatch` (I-03: the only mutation path)
 *
 * Coordinate conversion goes through `view/camera` (I-02) and the shared
 * position helper; hit-testing through `core/hitTest` with handles
 * (restricted to the current selection — handles are drawn there only).
 * Nothing starts while a pan owns the pointer (`isPanActive`: Space held or
 * actively panning — D-26) or for touch pointers.
 */

import { hitTestWithHandles } from '../core/hitTest';
import type { DocStore } from '../core/store';
import { screenToWorld } from '../view/camera';
import type { CameraStore } from '../view/cameraStore';
import type { UiStore } from '../view/uiStore';
import { pointerToCanvasPos } from './cursor';
import {
  type ConnectCtx,
  type ConnectEffect,
  type ConnectEvent,
  type ConnectState,
  initialConnectState,
  reduceConnect,
} from './connectTool';

export interface ConnectInputOptions {
  canvas: HTMLCanvasElement;
  cameraStore: CameraStore;
  docStore: DocStore;
  uiStore: UiStore;
  /** True while a pan gesture owns the pointer (Space held or panning). */
  isPanActive(): boolean;
}

export interface ConnectInput {
  detach(): void;
}

/**
 * Attach edge-connection input. Returns a `detach()` that removes every
 * listener.
 */
export function attachConnectInput(opts: ConnectInputOptions): ConnectInput {
  const { canvas, cameraStore, docStore, uiStore, isPanActive } = opts;

  /** Apply the machine's effects to the UI and doc stores (R3). */
  function applyEffects(effects: ConnectEffect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case 'setConnect':
          uiStore.setConnect(effect.preview);
          break;
        case 'dispatch':
          // The edge id in the preview command is a placeholder; replace with a real id.
          if (effect.command.type === 'edge.create') {
            const realId = crypto.randomUUID();
            docStore.dispatch({
              ...effect.command,
              edge: { ...effect.command.edge, id: realId },
            });
          } else {
            docStore.dispatch(effect.command);
          }
          break;
      }
    }
  }

  /** The machine context: the document as of this event. */
  function currentCtx(): ConnectCtx {
    return { doc: docStore.get() };
  }

  let state: ConnectState = initialConnectState();
  let capturedPointerId: number | null = null;

  /**
   * Hold pointer capture exactly while a connect gesture is active (T-020):
   * drags that cross the text-editor overlay (or leave the canvas) must keep
   * feeding the machine — without capture, the DOM element under the
   * pointer steals the moves and the gesture dies mid-drag.
   */
  function syncPointerCapture(): void {
    const gesturePointer = state.mode !== 'idle' ? state.pointerId : null;
    if (gesturePointer !== null && capturedPointerId === null) {
      try {
        canvas.setPointerCapture(gesturePointer);
        capturedPointerId = gesturePointer;
      } catch {
        // The pointer may already be gone; the gesture still works while
        // the pointer stays over the canvas.
      }
    } else if (gesturePointer === null && capturedPointerId !== null) {
      try {
        canvas.releasePointerCapture(capturedPointerId);
      } catch {
        // Capture may already be released.
      }
      capturedPointerId = null;
    }
  }

  /** Feed one event, apply its effects. */
  function feed(event: ConnectEvent): void {
    const result = reduceConnect(state, event, currentCtx());
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
    const hit = hitTestWithHandles(
      docStore.get(),
      world,
      cameraStore.get(),
      uiStore.get().selection,
    );
    feed({
      type: 'pointerDown',
      button: e.button,
      pointerId: e.pointerId,
      screen,
      world,
      hit,
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
    if (state.mode === 'idle') return; // nobody is connecting
    const { screen, world } = positions(e);
    const hit = hitTestWithHandles(
      docStore.get(),
      world,
      cameraStore.get(),
      uiStore.get().selection,
    );
    feed({ type: 'pointerUp', pointerId: e.pointerId, screen, world, hit });
  }

  function onPointerCancel(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    feed({ type: 'pointerCancel', pointerId: e.pointerId });
  }

  function onBlur(): void {
    feed({ type: 'blur' });
  }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('blur', onBlur);

    return {
      detach() {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerCancel);
        window.removeEventListener('blur', onBlur);
        if (capturedPointerId !== null) {
          try {
            canvas.releasePointerCapture(capturedPointerId);
          } catch {
            // Ignore.
          }
          capturedPointerId = null;
        }
        state = initialConnectState();
      },
    };
}