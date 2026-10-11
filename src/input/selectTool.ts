/**
 * Select tool state machine (T-008 R4) — pure, DOM-free (PLAN D-06).
 *
 * Implements D-26 (drag rules) and D-27 (delete) exactly:
 *
 * - A left press (button 0) on a node selects it (if not already selected)
 *   and starts a possible drag. A left press on empty space clears the
 *   selection. Space+left and the middle button never reach this machine —
 *   they belong to panning (the DOM glue checks `isPanActive`).
 * - The drag begins only after the pointer travels at least
 *   `DRAG_THRESHOLD` screen pixels (Euclidean) from the press point.
 * - While dragging, only `setDrag` effects are produced (I-04: pointer-move
 *   never commits; the document is untouched).
 * - Pointer-up after a drag dispatches exactly ONE `node.move` whose `dx`,
 *   `dy` are world deltas `worldPos(now) − worldPos(press)` — so zoom and
 *   mid-drag camera changes stay correct.
 * - Under the threshold, pointer-up is a click: no command.
 * - `Escape`, `pointercancel` and `blur` cancel a gesture with no command.
 * - `Delete`/`Backspace` (idle only, selection non-empty) dispatch one
 *   `node.delete`. A second pointer, other buttons, other keys and
 *   `Escape` when idle are all ignored.
 *
 * The DOM glue (`selectInput.ts`) feeds real events in and applies the
 * emitted effects to the UI store and the doc store.
 */

import type { Point } from '../core/geometry';
import type { Command, Id } from '../core/types';
import type { DragPreview } from '../view/uiStore';

/** The drag threshold in screen pixels (D-26): ≥ this distance starts a drag. */
export const DRAG_THRESHOLD = 4;

export type SelectMode = 'idle' | 'pressed' | 'dragging';

/** The machine state (R4): `startScreen`/`startWorld` are the press point. */
export interface SelectState {
  mode: SelectMode;
  pointerId: number | null;
  startScreen: Point | null;
  startWorld: Point | null;
  hitId: Id | null;
}

/** Events fed into the machine (R4). */
export type SelectEvent =
  | {
      type: 'pointerDown';
      button: number;
      pointerId: number;
      screen: Point;
      world: Point;
      hitId: Id | null;
    }
  | { type: 'pointerMove'; pointerId: number; screen: Point; world: Point }
  | { type: 'pointerUp'; pointerId: number; screen: Point; world: Point }
  | { type: 'pointerCancel'; pointerId: number }
  | { type: 'key'; key: string }
  | { type: 'blur' };

/** Effects the DOM glue applies (R4). */
export type SelectEffect =
  | { type: 'select'; ids: Id[] }
  | { type: 'setDrag'; drag: DragPreview | null }
  | { type: 'dispatch'; command: Command };

/** Per-event context: the current selection (read from the UI store). */
export interface SelectCtx {
  selection: Id[];
}

export interface SelectResult {
  state: SelectState;
  effects: SelectEffect[];
}

/** The initial idle state. */
export function initialSelectState(): SelectState {
  return {
    mode: 'idle',
    pointerId: null,
    startScreen: null,
    startWorld: null,
    hitId: null,
  };
}

/** Euclidean distance between two points, in screen pixels. */
function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The world-space drag delta from the press point to `world`. */
function worldDelta(state: SelectState, world: Point): { dx: number; dy: number } {
  const start = state.startWorld!;
  return { dx: world.x - start.x, dy: world.y - start.y };
}

/** The drag preview for the pressed node at `world` (D-26). */
function dragPreview(state: SelectState, world: Point): DragPreview {
  const { dx, dy } = worldDelta(state, world);
  return { ids: [state.hitId!], dx, dy };
}

/** The idle state after a gesture ends. */
function idle(): SelectState {
  return initialSelectState();
}

/**
 * Reduce one event (R4). Pure: returns the next state and the effects to
 * apply; mutates nothing. `ctx.selection` is the selection as of this event.
 */
export function reduce(
  state: SelectState,
  event: SelectEvent,
  ctx: SelectCtx,
): SelectResult {
  switch (event.type) {
    case 'pointerDown': {
      // Only the primary button starts select gestures (D-26); the middle
      // button and Space+left belong to panning and never get here.
      if (event.button !== 0) return { state, effects: [] };
      // A second pointer is ignored while a gesture is active.
      if (state.mode !== 'idle') return { state, effects: [] };

      if (event.hitId !== null) {
        // Press on a node: select it if it is not already selected, then
        // start a possible drag (D-26).
        const effects: SelectEffect[] = [];
        if (!ctx.selection.includes(event.hitId)) {
          effects.push({ type: 'select', ids: [event.hitId] });
        }
        return {
          state: {
            mode: 'pressed',
            pointerId: event.pointerId,
            startScreen: event.screen,
            startWorld: event.world,
            hitId: event.hitId,
          },
          effects,
        };
      }

      // Press on empty space: clear the selection; no gesture starts
      // (box-select is out of scope for T-008).
      if (ctx.selection.length > 0) {
        return { state: idle(), effects: [{ type: 'select', ids: [] }] };
      }
      return { state: idle(), effects: [] };
    }

    case 'pointerMove': {
      if (state.mode === 'idle') return { state, effects: [] };
      if (state.pointerId !== event.pointerId) return { state, effects: [] };

      if (state.mode === 'pressed') {
        // The drag begins only at/after the threshold (D-26).
        const d = dist(event.screen, state.startScreen!);
        if (d < DRAG_THRESHOLD) return { state, effects: [] };
        return {
          state: { ...state, mode: 'dragging' },
          effects: [{ type: 'setDrag', drag: dragPreview(state, event.world) }],
        };
      }

      // Dragging: pointer-move only updates the preview (I-04).
      return {
        state,
        effects: [{ type: 'setDrag', drag: dragPreview(state, event.world) }],
      };
    }

    case 'pointerUp': {
      if (state.mode === 'idle') return { state, effects: [] };
      if (state.pointerId !== event.pointerId) return { state, effects: [] };

      if (state.mode === 'pressed') {
        // Under the threshold it is a click: select only, no command (D-26).
        return { state: idle(), effects: [] };
      }

      // After a drag: clear the preview, then commit exactly one node.move
      // with world deltas (D-26, I-04).
      const { dx, dy } = worldDelta(state, event.world);
      return {
        state: idle(),
        effects: [
          { type: 'setDrag', drag: null },
          {
            type: 'dispatch',
            command: { type: 'node.move', ids: [state.hitId!], dx, dy },
          },
        ],
      };
    }

    case 'pointerCancel': {
      if (state.mode === 'idle') return { state, effects: [] };
      if (state.pointerId !== event.pointerId) return { state, effects: [] };
      // Cancel: no command (D-26).
      return cancel(state);
    }

    case 'key': {
      if (event.key === 'Escape') {
        // Escape when idle does nothing (R4).
        if (state.mode === 'idle') return { state, effects: [] };
        return cancel(state);
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        // Delete/Backspace while a gesture is active is ignored (R4); with
        // an empty selection there is nothing to delete (D-27).
        if (state.mode !== 'idle') return { state, effects: [] };
        if (ctx.selection.length === 0) return { state, effects: [] };
        return {
          state,
          effects: [
            {
              type: 'dispatch',
              command: { type: 'node.delete', ids: [...ctx.selection] },
            },
          ],
        };
      }
      // Any other key is ignored (R4).
      return { state, effects: [] };
    }

    case 'blur': {
      // Blur cancels any gesture, no command (D-26).
      if (state.mode === 'idle') return { state, effects: [] };
      return cancel(state);
    }
  }
}

/** Cancel an active gesture: back to idle, clear the preview, no command. */
function cancel(state: SelectState): SelectResult {
  const effects: SelectEffect[] =
    state.mode === 'dragging' ? [{ type: 'setDrag', drag: null }] : [];
  return { state: idle(), effects };
}
