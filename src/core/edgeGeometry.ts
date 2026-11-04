// Edge geometry (T-009 R3, PLAN D-31) — pure, deterministic, no DOM (D-06).
//
// Edges store node ids only (I-01); their on-canvas endpoints are computed
// from the current node rectangles. A fixed anchor is the midpoint of that
// side; 'auto' is the point where the line from the node's center toward the
// other node's center leaves the rectangle.
//
// T-033 (M9): an edge with route 'orthogonal' draws an elbow — a polyline
// of axis-aligned segments only. Its endpoints are SIDE MIDPOINTS: a fixed
// anchor already is one, and an 'auto' anchor selects the side at render
// time (orthogonalSide) instead of following the center-to-center ray,
// because a ray-intersection point is generally not on a horizontal or
// vertical exit line. 'auto' and 'straight' keep the two-point route, so
// every pre-route file renders pixel-identically (I-08).

import type { Anchor, Edge, EdgeRoute, Id, Node } from './types';
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

// ── Orthogonal routing (T-033, M9) ─────────────────────────────────────

/** The four sides of a node — the axis an orthogonal segment runs along. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/** The center point of a rect. */
function center(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** True when the side's segments run horizontally (left / right). */
function isHorizontal(side: Side): boolean {
  return side === 'left' || side === 'right';
}

/**
 * The side an orthogonal route leaves `rect` through when heading toward
 * `toward` (T-033): the DOMINANT axis decides — `|dx| >= |dy|` picks a
 * horizontal side (right when dx > 0, left otherwise), else a vertical one
 * (bottom when dy > 0, top otherwise). Coincident centers fall back to
 * 'right', mirroring `anchorPoint`'s D-31 fallback. Pure and deterministic.
 */
export function orthogonalSide(rect: Rect, toward: Point): Side {
  const c = center(rect);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return 'right'; // coincident centers (D-31)
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? 'right' : 'left';
  }
  return dy > 0 ? 'bottom' : 'top';
}

/**
 * The elbow polyline from `from` to `to` given the SIDE each end sits on
 * (T-033): two to four points, every segment strictly horizontal or
 * vertical by construction.
 *
 * - horizontal → horizontal: a Z through the mid-x `(from.x + to.x) / 2`
 *   (a single straight line when both midpoints already align).
 * - vertical → vertical: the same, mirrored, through the mid-y.
 * - horizontal → vertical: an L with its corner at `(to.x, from.y)`.
 * - vertical → horizontal: an L with its corner at `(from.x, to.y)`.
 */
export function elbow(from: Point, fromSide: Side, to: Point, toSide: Side): Point[] {
  const fromH = isHorizontal(fromSide);
  const toH = isHorizontal(toSide);
  if (fromH && toH) {
    const mx = (from.x + to.x) / 2;
    return [from, { x: mx, y: from.y }, { x: mx, y: to.y }, to];
  }
  if (!fromH && !toH) {
    const my = (from.y + to.y) / 2;
    return [from, { x: from.x, y: my }, { x: to.x, y: my }, to];
  }
  if (fromH) {
    // Horizontal leave, vertical arrival: corner at (to.x, from.y).
    return [from, { x: to.x, y: from.y }, to];
  }
  // Vertical leave, horizontal arrival: corner at (from.x, to.y).
  return [from, { x: from.x, y: to.y }, to];
}

/**
 * The route an edge actually takes: the stored route, 'auto' when absent
 * (T-033 — an edge written before routes exist routes like today).
 */
export function routeOf(edge: Edge): EdgeRoute {
  return edge.route ?? 'auto';
}

/**
 * The polyline an edge draws, computed from the CURRENT node rects at
 * render time (I-01, D-31). `rectOf(id)` returns that node's rect or
 * `undefined`; if either end's rect is missing the result is `null`.
 *
 * - route 'auto' / 'straight' (or absent): the two endpoints exactly as
 *   `edgeEndpoints` resolves them (the classic arrow, unchanged).
 * - route 'orthogonal': side-midpoint endpoints — a fixed anchor is its own
 *   side, an 'auto' anchor picks its side via `orthogonalSide` — joined by
 *   the `elbow` polyline.
 */
export function edgePoints(
  edge: Edge,
  rectOf: (id: Id) => Rect | undefined,
): Point[] | null {
  const fromRect = rectOf(edge.from.node);
  const toRect = rectOf(edge.to.node);
  if (fromRect === undefined || toRect === undefined) {
    return null;
  }
  if (routeOf(edge) !== 'orthogonal') {
    const endpoints = edgeEndpoints(edge, rectOf);
    return endpoints === null ? null : [endpoints.from, endpoints.to];
  }
  const fromToward = center(toRect);
  const toToward = center(fromRect);
  const fromSide: Side =
    edge.from.anchor === 'auto' ? orthogonalSide(fromRect, fromToward) : edge.from.anchor;
  const toSide: Side =
    edge.to.anchor === 'auto' ? orthogonalSide(toRect, toToward) : edge.to.anchor;
  const from = anchorPoint(fromRect, fromSide, fromToward);
  const to = anchorPoint(toRect, toSide, toToward);
  return elbow(from, fromSide, to, toSide);
}

/** The shortest distance from `p` to one segment `[a, b]`. */
function pointSegDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 0) {
    t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * The shortest distance from `p` to a polyline (T-033): the minimum over
 * its segments. Pure; a polyline of fewer than two points has no segments,
 * so the distance is `Infinity` (nothing to be near).
 */
export function polylineDistance(points: Point[], p: Point): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    best = Math.min(best, pointSegDistance(p, points[i - 1]!, points[i]!));
  }
  return best;
}

/**
 * The point at HALF the polyline's total arc length (T-033) — the label
 * anchor. For a two-point line that is the segment midpoint, exactly where
 * T-010 put labels, so pre-route rendering is unchanged.
 */
export function polylineMidpoint(points: Point[]): Point {
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
    lengths.push(len);
    total += len;
  }
  let remaining = total / 2;
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i]!;
    if (remaining <= len || i === lengths.length - 1) {
      const t = len === 0 ? 0 : remaining / len;
      const a = points[i]!;
      const b = points[i + 1]!;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= len;
  }
  return { ...points[0]! };
}
