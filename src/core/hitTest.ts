/**
 * Hit-testing (T-008 R1, T-011 R1, PLAN D-13/D-21): which node/handle is under
 * a world point?
 *
 * Pure, DOM-free (PLAN D-06). Returns the **top-most** node containing the
 * point: `doc.order` is bottom → top, so it is scanned from the end. The
 * edges of a node count as inside (`rectContains` is edge-inclusive).
 */

import { rectContains } from './geometry';
import type { Doc, Id, Anchor } from './types';
import type { Point } from './geometry';

/** Camera shape used for coordinate conversion (matches view/camera.ts). */
type Camera = { x: number; y: number; zoom: number };

/** screen = (world − cam) × zoom — pure, no DOM (I-02). */
function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/** A hit test result: either a node body or a connection handle. */
export type HitResult =
  | { type: 'node'; id: Id }
  | { type: 'handle'; id: Id; anchor: Anchor }
  | null;

/**
 * The id of the top-most node whose rect contains `point`, or `null` when no
 * node does (R1). Later entries in `doc.order` win: they are drawn on top
 * (D-21), so they are hit first.
 */
export function hitTest(doc: Doc, point: Point): Id | null {
  for (let i = doc.order.length - 1; i >= 0; i--) {
    const id = doc.order[i]!;
    const node = doc.nodes[id];
    if (node === undefined) continue; // defensive: order must be a permutation
    if (rectContains({ x: node.x, y: node.y, w: node.w, h: node.h }, point)) {
      return id;
    }
  }
  return null;
}

/**
 * Connection handle anchors (the 4 sides of a node).
 */
export const HANDLE_ANCHORS: Anchor[] = ['top', 'right', 'bottom', 'left'];

/**
 * The screen-space size of a connection handle hit target (CSS px).
 * This is the radius of the circular hit area around each handle midpoint.
 */
export const HANDLE_HIT_RADIUS = 8;

/**
 * Test if a world point hits a connection handle of the top-most node.
 * Returns `{ type: 'handle', id, anchor }` if a handle is hit, otherwise
 * falls back to `hitTest` for the node body, or `null`.
 *
 * Handles are at the midpoints of the 4 sides of the node's rect.
 * The hit test is done in screen space (so handle size is constant on screen).
 */
export function hitTestWithHandles(
  doc: Doc,
  point: Point,
  camera: { x: number; y: number; zoom: number },
): HitResult {
  // First check handles of the top-most node (in reverse order, same as hitTest).
  for (let i = doc.order.length - 1; i >= 0; i--) {
    const id = doc.order[i]!;
    const node = doc.nodes[id];
    if (node === undefined) continue;

    const rect = { x: node.x, y: node.y, w: node.w, h: node.h };

    // Check each handle (midpoint of each side).
    for (const anchor of HANDLE_ANCHORS) {
      const handlePoint = getHandleWorldPoint(rect, anchor);
      // Convert to screen space for constant-size hit testing.
      const handleScreen = worldToScreen(camera, handlePoint);
      const pointScreen = worldToScreen(camera, point);
      const dx = pointScreen.x - handleScreen.x;
      const dy = pointScreen.y - handleScreen.y;
      if (dx * dx + dy * dy <= HANDLE_HIT_RADIUS * HANDLE_HIT_RADIUS) {
        return { type: 'handle', id, anchor };
      }
    }
  }

  // No handle hit: fall back to node body hit test.
  const nodeId = hitTest(doc, point);
  return nodeId ? { type: 'node', id: nodeId } : null;
}

/** Get the world point for a handle anchor on a rect. */
function getHandleWorldPoint(rect: { x: number; y: number; w: number; h: number }, anchor: Anchor): Point {
  switch (anchor) {
    case 'top':
      return { x: rect.x + rect.w / 2, y: rect.y };
    case 'right':
      return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
    case 'bottom':
      return { x: rect.x + rect.w / 2, y: rect.y + rect.h };
    case 'left':
      return { x: rect.x, y: rect.y + rect.h / 2 };
    case 'auto':
      // 'auto' is not a fixed handle position; fall back to center.
      return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  }
}
