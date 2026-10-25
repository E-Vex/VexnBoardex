/**
 * Connection tool state machine (T-011 R2, T-018) — pure, DOM-free (PLAN D-06).
 *
 * Implements the edge creation gesture:
 * - A left press (button 0) on a connection handle starts a connection.
 * - While connecting, only `setConnect` effects are produced (I-04: pointer-move
 *   never commits; the document is untouched). The preview is a dedicated
 *   `ConnectPreview` (node + anchor + world endpoint) — never a node drag
 *   (T-018: the two preview kinds are no longer conflated).
 * - Pointer-up on another node's handle (or body) completes the connection
 *   with an `edge.create` command (auto-anchors: from = pressed handle,
 *   to = 'auto' if released on body, or the specific handle if released on handle).
 * - Pointer-up on empty space cancels.
 * - `Escape`, `pointercancel` and `blur` cancel the gesture with no command.
 */

import type { Point } from '../core/geometry';
import type { Command, Id, Anchor, Edge } from '../core/types';
import type { HitResult } from '../core/hitTest';
import type { ConnectPreview } from '../view/uiStore';

/** The drag threshold in screen pixels (D-26): ≥ this distance starts a drag. */
export const CONNECT_THRESHOLD = 4;

export type ConnectMode = 'idle' | 'connecting';

/** The machine state (R2): `startScreen`/`startWorld` are the press point. */
export interface ConnectState {
  mode: ConnectMode;
  pointerId: number | null;
  startScreen: Point | null;
  startWorld: Point | null;
  fromNode: Id | null;
  fromAnchor: Anchor | null;
}

/** Events fed into the machine (R2). */
export type ConnectEvent =
  | {
      type: 'pointerDown';
      button: number;
      pointerId: number;
      screen: Point;
      world: Point;
      hit: HitResult;
    }
  | { type: 'pointerMove'; pointerId: number; screen: Point; world: Point }
  | { type: 'pointerUp'; pointerId: number; screen: Point; world: Point; hit: HitResult }
  | { type: 'pointerCancel'; pointerId: number }
  | { type: 'key'; key: string }
  | { type: 'blur' };

/** Effects the DOM glue applies (R2). */
export type ConnectEffect =
  | { type: 'setConnect'; preview: ConnectPreview | null }
  | { type: 'dispatch'; command: Command };

/** Per-event context: the current document (for hit-testing on release). */
export interface ConnectCtx {
  doc: import('../core/types').Doc;
}

/**
 * Generate a provisional edge id for the preview (not used in the final command,
 * which gets its id from the caller). Purely for the UI preview.
 */
function previewEdgeId(): string {
  return '__preview__';
}

/** The idle state. */
export function initialConnectState(): ConnectState {
  return {
    mode: 'idle',
    pointerId: null,
    startScreen: null,
    startWorld: null,
    fromNode: null,
    fromAnchor: null,
  };
}

/** Euclidean distance between two points, in screen pixels. */
function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The connect preview for the line from the handle to `world` (T-018). */
function connectPreview(state: ConnectState, world: Point): ConnectPreview {
  return {
    fromNode: state.fromNode!,
    fromAnchor: state.fromAnchor as 'top' | 'right' | 'bottom' | 'left',
    to: { x: world.x, y: world.y },
  };
}

/** The idle state after a gesture ends. */
function idle(): ConnectState {
  return initialConnectState();
}

/**
 * Reduce one event (R2). Pure: returns the next state and the effects to
 * apply; mutates nothing. `_ctx.doc` is the document as of this event.
 */
export function reduceConnect(
  state: ConnectState,
  event: ConnectEvent,
  _ctx: ConnectCtx,
): { state: ConnectState; effects: ConnectEffect[] } {
  switch (event.type) {
    case 'pointerDown': {
      // Only the primary button starts connect gestures.
      if (event.button !== 0) return { state, effects: [] };
      // A second pointer is ignored while a gesture is active.
      if (state.mode !== 'idle') return { state, effects: [] };

      if (event.hit?.type === 'handle') {
        // Press on a handle: start a connection from this handle.
        return {
          state: {
            mode: 'connecting',
            pointerId: event.pointerId,
            startScreen: event.screen,
            startWorld: event.world,
            fromNode: event.hit.id,
            fromAnchor: event.hit.anchor,
          },
          effects: [],
        };
      }

      // Press on node body or empty space: do nothing (select tool handles those).
      return { state, effects: [] };
    }

    case 'pointerMove': {
      if (state.mode === 'idle') return { state, effects: [] };
      if (state.pointerId !== event.pointerId) return { state, effects: [] };

      // Check threshold to start the visual preview.
      if (state.mode === 'connecting') {
        const d = dist(event.screen, state.startScreen!);
        if (d < CONNECT_THRESHOLD) return { state, effects: [] };
      }

      // Update the preview line endpoint.
      return {
        state,
        effects: [
          { type: 'setConnect', preview: connectPreview(state, event.world) },
        ],
      };
    }

    case 'pointerUp': {
      if (state.mode === 'idle') return { state, effects: [] };
      if (state.pointerId !== event.pointerId) return { state, effects: [] };

      if (state.mode === 'connecting') {
        const fromNode = state.fromNode!;
        const fromAnchor = state.fromAnchor!;

        // Determine the target.
        let toNode: Id | null = null;
        let toAnchor: Anchor = 'auto';

        if (event.hit?.type === 'handle') {
          // Released on a handle: connect to that specific handle.
          if (event.hit.id !== fromNode) {
            // Prevent self-loops (validated in compileCommand anyway).
            toNode = event.hit.id;
            toAnchor = event.hit.anchor;
          }
        } else if (event.hit?.type === 'node') {
          // Released on a node body: connect with auto anchor.
          if (event.hit.id !== fromNode) {
            toNode = event.hit.id;
            toAnchor = 'auto';
          }
        }
        // Released on empty space: toNode stays null → cancel.

        if (toNode !== null) {
          // Create the edge command.
          const edge: Edge = {
            id: previewEdgeId(), // will be replaced by caller with real id
            from: { node: fromNode, anchor: fromAnchor },
            to: { node: toNode, anchor: toAnchor },
          };
          return {
            state: idle(),
            effects: [
              { type: 'setConnect', preview: null },
              { type: 'dispatch', command: { type: 'edge.create', edge } },
            ],
          };
        }

        // Cancel: no valid target.
        return {
          state: idle(),
          effects: [{ type: 'setConnect', preview: null }],
        };
      }

      return { state: idle(), effects: [{ type: 'setConnect', preview: null }] };
    }

    case 'pointerCancel': {
      if (state.mode === 'idle') return { state, effects: [] };
      if (state.pointerId !== event.pointerId) return { state, effects: [] };
      return {
        state: idle(),
        effects: [{ type: 'setConnect', preview: null }],
      };
    }

    case 'key': {
      if (event.key === 'Escape') {
        if (state.mode === 'idle') return { state, effects: [] };
        return {
          state: idle(),
          effects: [{ type: 'setConnect', preview: null }],
        };
      }
      // Any other key is ignored.
      return { state, effects: [] };
    }

    case 'blur': {
      if (state.mode === 'idle') return { state, effects: [] };
      return {
        state: idle(),
        effects: [{ type: 'setConnect', preview: null }],
      };
    }
  }
}