/**
 * Hit-testing (T-008 R1, PLAN D-13/D-21): which node is under a world point?
 *
 * Pure, DOM-free (PLAN D-06). Returns the **top-most** node containing the
 * point: `doc.order` is bottom → top, so it is scanned from the end. The
 * edges of a node count as inside (`rectContains` is edge-inclusive).
 */

import { rectContains } from './geometry';
import type { Doc, Id } from './types';
import type { Point } from './geometry';

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
