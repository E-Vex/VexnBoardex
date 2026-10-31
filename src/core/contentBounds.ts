/**
 * Content bounds (M8, T-027) — the tight axis-aligned bounding rect of
 * everything the board paints: every node rect plus every group frame
 * (a frame is its members' bbox + `GROUP_FRAME_PADDING`, PLAN T-024).
 *
 * Pure, DOM-free (D-06): just a fold over the document's geometry. The PNG
 * export uses it as the render region ("offscreen render of content bounds",
 * PLAN §6 M8); a `null` result means "nothing to export".
 */

import type { Rect } from './geometry';
import { groupFrameRect } from './hitTest';
import type { Doc } from './types';

/** Grow `acc` (min/max corners) to include `r`. */
function include(
  acc: { minX: number; minY: number; maxX: number; maxY: number },
  r: Rect,
): void {
  acc.minX = Math.min(acc.minX, r.x);
  acc.minY = Math.min(acc.minY, r.y);
  acc.maxX = Math.max(acc.maxX, r.x + r.w);
  acc.maxY = Math.max(acc.maxY, r.y + r.h);
}

/**
 * The bounding rect of all nodes and group frames in `doc`, or `null` when
 * the document has no content at all (no nodes — a group without members
 * paints no frame, so it contributes nothing).
 */
export function contentBounds(doc: Doc): Rect | null {
  const acc = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };

  for (const node of Object.values(doc.nodes)) {
    include(acc, { x: node.x, y: node.y, w: node.w, h: node.h });
  }

  // Group frames extend past their members by GROUP_FRAME_PADDING on every
  // side, so a framed group can be wider than its nodes alone.
  for (const groupId of Object.keys(doc.groups)) {
    const frame = groupFrameRect(doc, groupId);
    if (frame !== null) {
      include(acc, frame);
    }
  }

  if (!Number.isFinite(acc.minX)) return null;

  return {
    x: acc.minX,
    y: acc.minY,
    w: acc.maxX - acc.minX,
    h: acc.maxY - acc.minY,
  };
}
