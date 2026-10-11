// Pure geometry primitives for the core layer (no DOM — PLAN §4, D-06).

/** A point in world/CSS-pixel space. */
export interface Point {
  x: number;
  y: number;
}

/** An axis-aligned rectangle defined by its top-left corner and size. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Returns true when `point` lies inside `rect`.
 * All four edges are INCLUSIVE: a point exactly on the left, right, top or
 * bottom edge of the rect counts as contained. A zero-size rect (w = 0 and
 * h = 0) contains only the single point equal to its origin.
 */
export function rectContains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  );
}

/**
 * Returns true when two axis-aligned rectangles intersect (T-007 R1).
 *
 * Both rects are closed regions `[x, x+w] × [y, y+h]`, so rects that only
 * touch at an edge (or a corner) count as intersecting. Disjoint rects —
 * including a zero-area rect strictly outside the other — return false.
 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
  );
}
