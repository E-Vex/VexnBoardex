// Edge geometry (T-009 R3, PLAN D-31) — pure, deterministic, no DOM (D-06).
//
// Edges store node ids only (I-01); their on-canvas endpoints are computed
// from the current node rectangles. A fixed anchor is the midpoint of that
// side; 'auto' is the point where the line from the node's center toward the
// other node's center leaves the rectangle.

import type { Anchor, Edge, Id, Node } from './types';
import type { Point, Rect } from './geometry';

/** The bounding rect `{ x, y, w, h }` of a node. */
export function nodeRect(node: Node): Rect {
  return { x: node.x, y: node.y, w: node.w, h: node.h };
}

/**
 * The point where an edge endpoint attaches to `rect` (D-31).
 *
 * Fixed anchors are the side midpoints — `top` → `(x + w/2, y)`,
 * `bottom` → `(x + w/2, y + h)`, `left` → `(x, y + h/2)`,
 * `right` → `(x + w, y + h/2)` — and ignore `toward`. For `auto`, `toward`
 * is the center of the other node's rect: the result is where the ray from
 * this rect's center toward `toward` leaves the rectangle. If the direction
 * is `(0, 0)` (both centers coincide), the midpoint of the right side is
 * returned.
 */
export function anchorPoint(rect: Rect, anchor: Anchor, toward: Point): Point {
  switch (anchor) {
    case 'top':
      return { x: rect.x + rect.w / 2, y: rect.y };
    case 'bottom':
      return { x: rect.x + rect.w / 2, y: rect.y + rect.h };
    case 'left':
      return { x: rect.x, y: rect.y + rect.h / 2 };
    case 'right':
      return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
    case 'auto': {
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      const dx = toward.x - cx;
      const dy = toward.y - cy;
      if (dx === 0 && dy === 0) {
        // Both centers coincide: fall back to the right-side midpoint (D-31).
        return { x: rect.x + rect.w, y: cy };
      }
      const hx = rect.w / 2;
      const hy = rect.h / 2;
      // A zero component gives Infinity for that term, so min ignores it.
      const tx = dx === 0 ? Infinity : hx / Math.abs(dx);
      const ty = dy === 0 ? Infinity : hy / Math.abs(dy);
      const t = Math.min(tx, ty);
      return { x: cx + dx * t, y: cy + dy * t };
    }
  }
}

/**
 * The two endpoints of an edge, computed from the current node rects
 * (I-01, D-31). `rectOf(id)` returns that node's rect or `undefined` when
 * the node does not exist; if either end's rect is missing the result is
 * `null`. For an `auto` end, `toward` is the center of the OTHER node's
 * rect (not the other end's resolved point). Fixed anchors ignore `toward`.
 */
export function edgeEndpoints(
  edge: Edge,
  rectOf: (id: Id) => Rect | undefined,
): { from: Point; to: Point } | null {
  const fromRect = rectOf(edge.from.node);
  const toRect = rectOf(edge.to.node);
  if (fromRect === undefined || toRect === undefined) {
    return null;
  }
  const fromToward: Point = {
    x: toRect.x + toRect.w / 2,
    y: toRect.y + toRect.h / 2,
  };
  const toToward: Point = {
    x: fromRect.x + fromRect.w / 2,
    y: fromRect.y + fromRect.h / 2,
  };
  return {
    from: anchorPoint(fromRect, edge.from.anchor, fromToward),
    to: anchorPoint(toRect, edge.to.anchor, toToward),
  };
}
