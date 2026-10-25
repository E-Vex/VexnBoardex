/**
 * Select tool state machine (T-008 R4, T-016) — pure, DOM-free (PLAN D-06).
 *
 * Implements D-26 (drag rules) and D-27 (delete) exactly:
 *
 * - A left press (button 0) on a node selects it (if not already selected)
 *   and starts a possible drag. When the pressed node belongs to the current
 *   selection, the whole selection drags together (T-017: group move).
 * - A left press on empty space starts a box-select (marquee), whether or
 *   not anything is selected (T-017: a fresh board can marquee too). A
 *   click-sized marquee selects nothing, so a plain click on empty space
 *   still clears the selection.
 *   Space+left and the middle button never reach this machine — they
 *   belong to panning (the DOM glue checks `isPanActive`).
 * - The drag begins only after the pointer travels at least
 *   `DRAG_THRESHOLD` screen pixels (Euclidean) from the press point.
 * - While dragging, only `setDrag` effects are produced (I-04: pointer-move
 *   never commits; the document is untouched).
 * - Pointer-up after a drag dispatches exactly ONE `node.move` whose `dx`,
 *   `dy` are world deltas `worldPos(now) − worldPos(press)` — so zoom and
 *   mid-drag camera changes stay correct.
 * - Pointer-up at the end of a box-select emits `selectInRect` (the final
 *   screen-space rect); the DOM glue resolves it against the document.
 * - Under the threshold, pointer-up is a click: no command.
 * - `Escape`, `pointercancel` and `blur` cancel a gesture with no command.
 * - `Delete`/`Backspace` (idle only, selection non-empty) dispatch one
 *   `node.delete`. A second pointer, other buttons, other keys and
 *   `Escape` when idle are all ignored.
 * - T-016: Shift+click toggles node in selection.
 * - T-016: Drag on empty space starts box-select (marquee).
 * - T-016: Arrow keys nudge selected nodes.
 *
 * The DOM glue (`selectInput.ts`) feeds real events in and applies the
 * emitted effects to the UI store and the doc store.
 */

import type { Point } from '../core/geometry';
import type { Command, Id } from '../core/types';
import type { ResizeCorner } from '../core/hitTest';
import type { DragPreview } from '../view/uiStore';

/** The drag threshold in screen pixels (D-26): ≥ this distance starts a drag. */
export const DRAG_THRESHOLD = 4;

/** The nudge distance in world units for arrow keys (T-016). */
export const NUDGE_DISTANCE = 10;

/** The minimum width/height a resize gesture may produce (T-021). */
export const MIN_NODE_SIZE = 20;

export type SelectMode = 'idle' | 'pressed' | 'dragging' | 'boxSelecting' | 'resizing';

/** The state machine state (R4): `startScreen`/`startWorld` are the press point. */
export interface SelectState {
  mode: SelectMode;
  pointerId: number | null;
  startScreen: Point | null;
  startWorld: Point | null;
  hitId: Id | null;
  /** For box-select: the screen rect of the marquee. */
  boxSelectRect: { x: number; y: number; w: number; h: number } | null;
  /** The ids that move together during a drag (T-017: group move). */
  dragIds: Id[];
  /** For resizing: the node, its corner and the rect at press time (T-021). */
  resize: { id: Id; corner: ResizeCorner; rect: { x: number; y: number; w: number; h: number } } | null;
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
      shiftKey: boolean;
      /** A resize handle under the press (T-021): its node, corner and the
       * node's current rect. Present only for the single selected node. */
      resize?: { id: Id; corner: ResizeCorner; rect: { x: number; y: number; w: number; h: number } } | null;
    }
  | { type: 'pointerMove'; pointerId: number; screen: Point; world: Point }
  | { type: 'pointerUp'; pointerId: number; screen: Point; world: Point }
  | { type: 'pointerCancel'; pointerId: number }
  | { type: 'key'; key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }
  | { type: 'blur' };

/** Effects the DOM glue applies (R4). */
export type SelectEffect =
  | { type: 'select'; ids: Id[] }
  | { type: 'setDrag'; drag: DragPreview | null }
  | { type: 'dispatch'; command: Command }
  | { type: 'setBoxSelect'; rect: { x: number; y: number; w: number; h: number } | null }
  | {
      /** Select every node intersecting this screen-space rect (T-017). */
      type: 'selectInRect';
      rect: { x: number; y: number; w: number; h: number };
    }
  | {
      /** Show a resize preview rect for a node (T-021). */
      type: 'setResize';
      rect: { id: Id; x: number; y: number; w: number; h: number } | null;
    };

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
    boxSelectRect: null,
    dragIds: [],
    resize: null,
  };
}

/**
 * The resize rect resulting from dragging `corner` of `orig` to `world`
 * (T-021): the opposite corner stays anchored; both dimensions clamp to
 * MIN_NODE_SIZE. Pure.
 */
export function resizeRect(
  orig: { x: number; y: number; w: number; h: number },
  corner: ResizeCorner,
  world: Point,
): { x: number; y: number; w: number; h: number } {
  let x = orig.x;
  let y = orig.y;
  let w = orig.w;
  let h = orig.h;
  switch (corner) {
    case 'nw':
      x = world.x;
      y = world.y;
      w = orig.x + orig.w - world.x;
      h = orig.y + orig.h - world.y;
      break;
    case 'ne':
      y = world.y;
      w = world.x - orig.x;
      h = orig.y + orig.h - world.y;
      break;
    case 'sw':
      x = world.x;
      w = orig.x + orig.w - world.x;
      h = world.y - orig.y;
      break;
    case 'se':
      w = world.x - orig.x;
      h = world.y - orig.y;
      break;
  }
  // Clamp to the minimum, keeping the anchored corner fixed.
  if (w < MIN_NODE_SIZE) {
    if (corner === 'nw' || corner === 'sw') {
      x = orig.x + orig.w - MIN_NODE_SIZE;
    }
    w = MIN_NODE_SIZE;
  }
  if (h < MIN_NODE_SIZE) {
    if (corner === 'nw' || corner === 'ne') {
      y = orig.y + orig.h - MIN_NODE_SIZE;
    }
    h = MIN_NODE_SIZE;
  }
  return { x, y, w, h };
}

/** The marquee rect spanned by two screen points, normalised to positive w/h. */
function marqueeRect(
  a: Point,
  b: Point,
): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
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

/** The drag preview for the dragged nodes at `world` (D-26, T-017). */
function dragPreview(state: SelectState, world: Point): DragPreview {
  const { dx, dy } = worldDelta(state, world);
  return { ids: state.dragIds, dx, dy };
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

      // A press on a resize handle of the single selected node starts a
      // resize gesture (T-021): the selection stays, no marquee, no drag.
      if (event.resize !== null && event.resize !== undefined) {
        return {
          state: {
            ...initialSelectState(),
            mode: 'resizing',
            pointerId: event.pointerId,
            startScreen: event.screen,
            startWorld: event.world,
            hitId: event.resize.id,
            resize: event.resize,
          },
          effects: [],
        };
      }

      if (event.hitId !== null) {
        // Press on a node: shift+click toggles, otherwise select (or keep selected)
        // and start a possible drag (D-26). When the pressed node belongs to
        // the selection, the whole selection drags together (T-017).
        const effects: SelectEffect[] = [];
        let dragIds: Id[];
        if (event.shiftKey) {
          // Toggle selection
          const newSelection = ctx.selection.includes(event.hitId)
            ? ctx.selection.filter((id) => id !== event.hitId)
            : [...ctx.selection, event.hitId];
          effects.push({ type: 'select', ids: newSelection });
          // The toggle has taken effect: drag what the selection will be.
          dragIds = newSelection.includes(event.hitId)
            ? newSelection
            : [event.hitId];
        } else if (ctx.selection.includes(event.hitId)) {
          dragIds = [...ctx.selection];
        } else {
          // Select only this node (replacing selection)
          effects.push({ type: 'select', ids: [event.hitId] });
          dragIds = [event.hitId];
        }
        return {
          state: {
            mode: 'pressed',
            pointerId: event.pointerId,
            startScreen: event.screen,
            startWorld: event.world,
            hitId: event.hitId,
            boxSelectRect: null,
            dragIds,
            resize: null,
          },
          effects,
        };
      }

      // Press on empty space: start a box-select marquee (T-017: always,
      // whether or not anything is selected). The selection is cleared up
      // front when non-empty; the marquee's pointer-up then selects whatever
      // intersects the rect (nothing for a click-sized rect).
      const effects: SelectEffect[] =
        ctx.selection.length > 0 ? [{ type: 'select', ids: [] }] : [];
      const rect = marqueeRect(event.screen, event.screen);
      return {
        state: {
          ...initialSelectState(),
          mode: 'boxSelecting',
          pointerId: event.pointerId,
          startScreen: event.screen,
          startWorld: event.world,
          boxSelectRect: rect,
          dragIds: [],
          resize: null,
        },
        effects: [...effects, { type: 'setBoxSelect', rect }],
      };
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

      if (state.mode === 'boxSelecting') {
        // Update box-select rectangle.
        const x = Math.min(state.startScreen!.x, event.screen.x);
        const y = Math.min(state.startScreen!.y, event.screen.y);
        const w = Math.abs(event.screen.x - state.startScreen!.x);
        const h = Math.abs(event.screen.y - state.startScreen!.y);
        return {
          state: { ...state, boxSelectRect: { x, y, w, h } },
          effects: [{ type: 'setBoxSelect', rect: { x, y, w, h } }],
        };
      }

      if (state.mode === 'resizing') {
        // Pointer-move only updates the preview rect (I-04, T-021).
        const rect = resizeRect(state.resize!.rect, state.resize!.corner, event.world);
        return {
          state,
          effects: [
            {
              type: 'setResize',
              rect: { id: state.resize!.id, x: rect.x, y: rect.y, w: rect.w, h: rect.h },
            },
          ],
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

      if (state.mode === 'boxSelecting') {
        // Finalize the box-select: emit the final marquee rect; the DOM glue
        // resolves it against the document and sets the selection (T-017).
        const rect = marqueeRect(state.startScreen!, event.screen);
        return {
          state: idle(),
          effects: [
            { type: 'setBoxSelect', rect: null },
            { type: 'selectInRect', rect },
          ],
        };
      }

      if (state.mode === 'resizing') {
        // Commit exactly ONE node.resize with the rect at release (T-021,
        // I-04: pointer-move only previewed until now).
        const final = resizeRect(state.resize!.rect, state.resize!.corner, event.world);
        return {
          state: idle(),
          effects: [
            { type: 'setResize', rect: null },
            {
              type: 'dispatch',
              command: {
                type: 'node.resize',
                id: state.resize!.id,
                x: final.x,
                y: final.y,
                w: final.w,
                h: final.h,
              },
            },
          ],
        };
      }

      // After a drag: clear the preview, then commit exactly one node.move
      // with world deltas (D-26, I-04). Every dragged id moves together
      // (T-017: group move).
      const { dx, dy } = worldDelta(state, event.world);
      return {
        state: idle(),
        effects: [
          { type: 'setDrag', drag: null },
          {
            type: 'dispatch',
            command: { type: 'node.move', ids: [...state.dragIds], dx, dy },
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
      // Arrow keys for nudging (T-016).
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        if (ctx.selection.length === 0) return { state, effects: [] };
        // Nudge: dispatch node.move for all selected nodes.
        let dx = 0, dy = 0;
        switch (event.key) {
          case 'ArrowUp': dy = -NUDGE_DISTANCE; break;
          case 'ArrowDown': dy = NUDGE_DISTANCE; break;
          case 'ArrowLeft': dx = -NUDGE_DISTANCE; break;
          case 'ArrowRight': dx = NUDGE_DISTANCE; break;
        }
        return {
          state,
          effects: [
            {
              type: 'dispatch',
              command: { type: 'node.move', ids: [...ctx.selection], dx, dy },
            },
          ],
        };
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
    state.mode === 'dragging' || state.mode === 'boxSelecting'
      ? [{ type: 'setDrag', drag: null }, { type: 'setBoxSelect', rect: null }]
      : state.mode === 'resizing'
        ? [{ type: 'setResize', rect: null }]
        : [];
  return { state: idle(), effects };
}