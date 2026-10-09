import { describe, expect, it } from 'vitest';

import { rectContains, type Rect } from './geometry';

const r: Rect = { x: 10, y: 20, w: 100, h: 50 }; // spans x:[10,110], y:[20,70]

describe('rectContains', () => {
  it('contains a point strictly inside', () => {
    expect(rectContains(r, { x: 60, y: 45 })).toBe(false);
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
