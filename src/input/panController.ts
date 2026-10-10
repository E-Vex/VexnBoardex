/**
 * Pan controller — a pure state machine (T-005 R3, PLAN §4 input state machine).
 *
 * Pure and DOM-free (PLAN D-06, R7): no `window`, `document`, canvas or DOM
 * types. It receives events and returns the next state plus an optional pan
 * delta. The DOM glue (`cameraInput.ts`) feeds real pointer/keyboard events
 * in and applies the emitted deltas to the camera.
 *
 * Modes:
 *   idle   → panning (button 1, or button 0 with spaceHeld)
 *   panning → idle (pointer up / cancel / blur)
 */

import type { Point } from '../core/geometry';

export type PanMode = 'idle' | 'panning';

export interface PanState {
  mode: PanMode;
  spaceHeld: boolean;
  last: Point | null;
  pointerId: number | null;
}

/** Events fed into the state machine. */
export type PanEvent =
  | { type: 'spaceDown' }
  | { type: 'spaceUp' }
  | { type: 'blur' }
  | { type: 'pointerDown'; button: number; pointerId: number; pos: Point }
  | { type: 'pointerMove'; pointerId: number; pos: Point }
  | { type: 'pointerUp'; pointerId: number }
  | { type: 'pointerCancel'; pointerId: number };

/** Result of reducing one event: the new state and an optional pan delta. */
export interface PanResult {
  state: PanState;
  pan?: { dx: number; dy: number };
}

/** The initial idle state with nothing held and no active pointer. */
export function initialPanState(): PanState {
  return {
    mode: 'idle',
    spaceHeld: false,
    last: null,
    pointerId: null,
  };
}

/**
 * The CSS cursor for a pan state:
 * - `'grabbing'` when panning
 * - `'grab'` when space is held (but not panning)
 * - `'default'` otherwise
 */
export function cursorFor(state: PanState): string {
  if (state.mode === 'panning') return 'grabbing';
  if (state.spaceHeld) return 'grab';
  return 'default';
}

/**
 * Reduce one event. Returns the next state and, when a `pointerMove` happened
 * for the active pointer while panning, a `pan` delta (`pos − last`) in screen
 * pixels. Rules (R3):
 *
 * - `pointerDown` starts panning only if idle and (button 1, or button 0 with
 *   `spaceHeld`). A left press without Space does nothing.
 * - `pointerMove` for the active pointer while panning emits `pan = pos − last`,
 *   then updates `last`.
 * - `pointerUp` / `pointerCancel` for the active pointer returns to idle and
 *   keeps `spaceHeld`.
 * - `spaceUp` during a pan clears `spaceHeld` but keeps panning until release.
 * - `blur` resets to idle with `spaceHeld = false`.
 * - Events for a pointer that is not the active one are ignored.
 */
export function reduce(state: PanState, event: PanEvent): PanResult {
  switch (event.type) {
    case 'spaceDown':
      if (state.spaceHeld) return { state };
      return { state: { ...state, spaceHeld: true } };

    case 'spaceUp':
      if (!state.spaceHeld) return { state };
      return { state: { ...state, spaceHeld: false } };

    case 'blur':
      return { state: initialPanState() };

    case 'pointerDown': {
      if (state.mode !== 'idle') return { state };
      const canPan =
        event.button === 1 || (event.button === 0 && state.spaceHeld);
      if (!canPan) return { state };
      return {
        state: {
          mode: 'panning',
          spaceHeld: state.spaceHeld,
          last: event.pos,
          pointerId: event.pointerId,
        },
      };
    }

    case 'pointerMove': {
      if (
        state.mode !== 'panning' ||
        state.pointerId !== event.pointerId ||
        state.last === null
      ) {
        return { state };
      }
      const dx = event.pos.x - state.last.x;
      const dy = event.pos.y - state.last.y;
      return {
        state: { ...state, last: event.pos },
        pan: { dx, dy },
      };
    }

    case 'pointerUp':
    case 'pointerCancel': {
      if (
        state.mode !== 'panning' ||
        state.pointerId !== event.pointerId
      ) {
        return { state };
      }
      return {
        state: {
          mode: 'idle',
          spaceHeld: state.spaceHeld,
          last: null,
          pointerId: null,
        },
      };
    }
  }
}
