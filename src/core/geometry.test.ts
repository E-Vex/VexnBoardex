import { describe, expect, it } from 'vitest';

import { rectContains, rectsIntersect, type Rect } from './geometry';

const r: Rect = { x: 10, y: 20, w: 100, h: 50 }; // spans x:[10,110], y:[20,70]

describe('rectContains', () => {
  it('contains a point strictly inside', () => {
    expect(rectContains(r, { x: 60, y: 45 })).toBe(true);
  });

  it('rejects points outside on every side', () => {
    expect(rectContains(r, { x: 9, y: 45 })).toBe(false); // left
    expect(rectContains(r, { x: 111, y: 45 })).toBe(false); // right
    expect(rectContains(r, { x: 60, y: 19 })).toBe(false); // above
    expect(rectContains(r, { x: 60, y: 71 })).toBe(false); // below
    expect(rectContains(r, { x: 0, y: 0 })).toBe(false); // far away
  });

  it('includes the left edge', () => {
    expect(rectContains(r, { x: 10, y: 45 })).toBe(true);
  });

  it('includes the right edge', () => {
    expect(rectContains(r, { x: 110, y: 45 })).toBe(true);
  });

  it('includes the top edge', () => {
    expect(rectContains(r, { x: 60, y: 20 })).toBe(true);
  });

  it('includes the bottom edge', () => {
    expect(rectContains(r, { x: 60, y: 70 })).toBe(true);
  });

  it('includes all four corners', () => {
    expect(rectContains(r, { x: 10, y: 20 })).toBe(true);
    expect(rectContains(r, { x: 110, y: 20 })).toBe(true);
    expect(rectContains(r, { x: 10, y: 70 })).toBe(true);
    expect(rectContains(r, { x: 110, y: 70 })).toBe(true);
  });

  it('handles a zero-size rect (single point)', () => {
    const p: Rect = { x: 5, y: 5, w: 0, h: 0 };
    expect(rectContains(p, { x: 5, y: 5 })).toBe(true);
    expect(rectContains(p, { x: 6, y: 5 })).toBe(false);
    expect(rectContains(p, { x: 5, y: 4 })).toBe(false);
  });

  it('handles negative coordinates', () => {
    const n: Rect = { x: -30, y: -20, w: 10, h: 10 }; // x:[-30,-20], y:[-20,-10]
    expect(rectContains(n, { x: -25, y: -15 })).toBe(true); // inside
    expect(rectContains(n, { x: -30, y: -20 })).toBe(true); // corner, inclusive
    expect(rectContains(n, { x: -20, y: -10 })).toBe(true); // opposite corner
    expect(rectContains(n, { x: -19, y: -15 })).toBe(false); // just outside
    expect(rectContains(n, { x: 0, y: 0 })).toBe(false); // origin is outside
  });
});

// T-007 R1 — rectsIntersect. Rect r spans x:[10,110], y:[20,70].
describe('rectsIntersect', () => {
  it('true when one rect contains the other', () => {
    const inner: Rect = { x: 40, y: 30, w: 10, h: 10 };
    const outer: Rect = { x: 0, y: 0, w: 500, h: 500 };
    expect(rectsIntersect(r, inner)).toBe(true);
    expect(rectsIntersect(inner, r)).toBe(true);
    expect(rectsIntersect(r, outer)).toBe(true);
    expect(rectsIntersect(outer, r)).toBe(true);
  });

  it('true for a partial overlap on each side', () => {
    expect(rectsIntersect(r, { x: 100, y: 30, w: 50, h: 10 })).toBe(true); // right
    expect(rectsIntersect(r, { x: 0, y: 30, w: 20, h: 10 })).toBe(true); // left
    expect(rectsIntersect(r, { x: 40, y: 60, w: 10, h: 50 })).toBe(true); // below
    expect(rectsIntersect(r, { x: 40, y: 10, w: 5, h: 15 })).toBe(true); // above
  });

  it('false for disjoint rects on each side', () => {
    expect(rectsIntersect(r, { x: 111, y: 0, w: 5, h: 5 })).toBe(false); // right
    expect(rectsIntersect(r, { x: 0, y: 0, w: 9, h: 5 })).toBe(false); // left
    expect(rectsIntersect(r, { x: 0, y: 71, w: 5, h: 5 })).toBe(false); // below
    expect(rectsIntersect(r, { x: 0, y: 0, w: 5, h: 19 })).toBe(false); // above
    expect(rectsIntersect(r, { x: 200, y: 200, w: 10, h: 10 })).toBe(false); // diagonal
  });

  it('edge-touching rects count as intersecting (R1)', () => {
    // Shares only the left edge x = 10.
    expect(rectsIntersect(r, { x: 0, y: 30, w: 10, h: 5 })).toBe(true);
    // Shares only the right edge x = 110.
    expect(rectsIntersect(r, { x: 110, y: 30, w: 10, h: 5 })).toBe(true);
    // Shares only the top edge y = 20.
    expect(rectsIntersect(r, { x: 40, y: 0, w: 5, h: 20 })).toBe(true);
    // Shares only the bottom edge y = 70.
    expect(rectsIntersect(r, { x: 40, y: 70, w: 5, h: 10 })).toBe(true);
  });

  it('corner-touching rects count as intersecting', () => {
    // Touches only at the corner (110, 70).
    expect(rectsIntersect(r, { x: 110, y: 70, w: 10, h: 10 })).toBe(true);
    // Touches only at the corner (10, 20).
    expect(rectsIntersect(r, { x: 0, y: 0, w: 10, h: 20 })).toBe(true);
  });

  it('a rect intersects itself and an identical rect', () => {
    expect(rectsIntersect(r, r)).toBe(true);
    expect(rectsIntersect(r, { ...r })).toBe(true);
  });

  it('one pixel away in any direction is disjoint', () => {
    expect(rectsIntersect(r, { x: 111, y: 30, w: 5, h: 5 })).toBe(false);
    expect(rectsIntersect(r, { x: 4, y: 30, w: 5, h: 5 })).toBe(false); // ends at x=9
    expect(rectsIntersect(r, { x: 40, y: 71, w: 5, h: 5 })).toBe(false);
    expect(rectsIntersect(r, { x: 40, y: 14, w: 5, h: 5 })).toBe(false); // ends at y=19
  });

  it('works with negative coordinates', () => {
    const n: Rect = { x: -30, y: -20, w: 10, h: 10 }; // x:[-30,-20], y:[-20,-10]
    expect(rectsIntersect(n, { x: -25, y: -15, w: 5, h: 5 })).toBe(true);
    expect(rectsIntersect(n, { x: -20, y: -15, w: 5, h: 5 })).toBe(true); // edge
    expect(rectsIntersect(n, { x: -19, y: -15, w: 5, h: 5 })).toBe(false);
    expect(rectsIntersect(n, { x: 0, y: 0, w: 5, h: 5 })).toBe(false);
  });

  it('a zero-size rect intersects when its point lies on the other rect', () => {
    const point: Rect = { x: 60, y: 45, w: 0, h: 0 };
    expect(rectsIntersect(r, point)).toBe(true); // strictly inside
    expect(rectsIntersect(r, { x: 10, y: 20, w: 0, h: 0 })).toBe(true); // corner
    expect(rectsIntersect(r, { x: 111, y: 45, w: 0, h: 0 })).toBe(false); // outside
  });
});
