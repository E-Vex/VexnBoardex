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

/** A hit test result: a node body, a connection handle or a resize handle. */
export type HitResult =
  | { type: 'node'; id: Id }
  | { type: 'handle'; id: Id; anchor: Anchor }
  | { type: 'resize'; id: Id; corner: ResizeCorner }
  | null;

/** The corners a resize handle can sit on (T-021). */
export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

/** The padding around a group's bounding box, in world units (T-024). */
export const GROUP_FRAME_PADDING = 16;

/**
 * The ids of every node that belongs to `nodeId`'s group (including the
 * node itself); [] when the node is ungrouped (T-024). Pure.
 */
export function groupMembersOf(doc: Doc, nodeId: Id): Id[] {
  const node = doc.nodes[nodeId];
  if (node === undefined || node.groupId === undefined) return [];
  const members: Id[] = [];
  for (const id of doc.order) {
    const n = doc.nodes[id];
    if (n !== undefined && n.groupId === node.groupId) {
      members.push(id);
    }
  }
  return members;
}

/**
 * The group whose frame (its members' bounding box + GROUP_FRAME_PADDING)
 * contains `point` — the frame click target (T-024). A point inside any
 * NODE never matches here: callers check `hitTest` first. Groups are
 * checked in `Object.values` insertion order; the last hit wins.
 */
export function groupFrameAt(doc: Doc, point: Point): Id | null {
  let hit: Id | null = null;
  for (const [groupId] of Object.entries(doc.groups)) {
    const rect = groupFrameRect(doc, groupId);
    if (rect !== null && rectContains(rect, point)) {
      hit = groupId;
    }
  }
  return hit;
}

/** The frame rect of a group: its members' bbox + padding, or null when it
 * has no members (T-024). Pure. */
export function groupFrameRect(
  doc: Doc,
  groupId: Id,
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of Object.values(doc.nodes)) {
    if (node.groupId !== groupId) continue;
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.w);
    maxY = Math.max(maxY, node.y + node.h);
  }
  if (!Number.isFinite(minX)) return null; // no members
  return {
    x: minX - GROUP_FRAME_PADDING,
    y: minY - GROUP_FRAME_PADDING,
    w: maxX - minX + GROUP_FRAME_PADDING * 2,
    h: maxY - minY + GROUP_FRAME_PADDING * 2,
  };
}

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
 * The screen-space hit radius of a resize handle (CSS px) (T-021).
 */
export const RESIZE_HANDLE_HIT_RADIUS = 8;

/**
 * Test if a world point hits a resize handle of the single selected node
 * (T-021): resize handles exist only when exactly one node is selected.
 * Returns `{ type: 'resize', id, corner }` on a hit, else falls through to
 * the connection-handle test. Hit-testing happens in screen space so the
 * targets stay constant on screen at any zoom.
 */
export function hitTestResizeHandles(
  doc: Doc,
  point: Point,
  camera: { x: number; y: number; zoom: number },
  selection: Id[],
): HitResult {
  if (selection.length !== 1) return null; // resize handles: single selection only
  const id = selection[0]!;
  const node = doc.nodes[id];
  if (node === undefined) return null;

  const pointScreen = worldToScreen(camera, point);
  const corners: [ResizeCorner, number, number][] = [
    ['nw', node.x, node.y],
    ['ne', node.x + node.w, node.y],
    ['sw', node.x, node.y + node.h],
    ['se', node.x + node.w, node.y + node.h],
  ];
  for (const [corner, wx, wy] of corners) {
    const cScreen = worldToScreen(camera, { x: wx, y: wy });
    const dx = pointScreen.x - cScreen.x;
    const dy = pointScreen.y - cScreen.y;
    if (dx * dx + dy * dy <= RESIZE_HANDLE_HIT_RADIUS * RESIZE_HANDLE_HIT_RADIUS) {
      return { type: 'resize', id, corner };
    }
  }
  return null;
}

/**
 * Test if a world point hits a connection handle of a **selected** node
 * (T-018: handles are drawn only on selected nodes, so only those are
 * hit-testable). Returns `{ type: 'handle', id, anchor }` if a handle is
 * hit, otherwise falls back to `hitTest` for the node body, or `null`.
 *
 * Handles are at the midpoints of the 4 sides of the node's rect.
 * The hit test is done in screen space (so handle size is constant on screen).
 */
export function hitTestWithHandles(
  doc: Doc,
  point: Point,
  camera: { x: number; y: number; zoom: number },
  selection: Id[],
): HitResult {
  // Handles of unselected nodes are not drawn — not hit-testable. An empty
  // selection skips every node's handles.
  const selected = new Set<Id>(selection);
  for (let i = doc.order.length - 1; i >= 0; i--) {
    const id = doc.order[i]!;
    if (!selected.has(id)) continue;
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
