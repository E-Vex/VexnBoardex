/**
 * Unit and seeded property tests for edge geometry (T-009 R5, PLAN D-31).
 *
 * Fixed anchors are side midpoints; `auto` is where the center-to-center
 * ray leaves the rectangle. Properties: endpoints lie on the rect boundary,
 * swapping the ends swaps the endpoints, translation commutes, and (for
 * fixed anchors) moving one rect moves only its own endpoint.
 */

import { describe, expect, it } from 'vitest';

import type { Anchor, Edge, Node } from './types';
import { anchorPoint, edgeEndpoints, nodeRect } from './edgeGeometry';
import type { Point, Rect } from './geometry';
import { mulberry32, randInt } from './prng.helper';

// Rect from the brief: x:[10,110], y:[20,80], center (60,50).
const R: Rect = { x: 10, y: 20, w: 100, h: 60 };

function node(id: string, overrides: Partial<Node> = {}): Node {
  return {
    id,
    kind: 'card',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    text: '',
    color: '#fff',
    tags: [],
    ...overrides,
  };
}

/** Freeze deeply so any mutation throws (T-009 R5). */
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  if (Array.isArray(obj)) {
    for (const el of obj) deepFreeze(el);
  } else {
    for (const v of Object.values(obj as Record<string, unknown>)) {
      deepFreeze(v);
    }
  }
  return obj;
}

describe('nodeRect', () => {
  it('returns the node bounding rect', () => {
    expect(nodeRect(node('n1', { x: 5, y: -7, w: 120, h: 80 }))).toEqual({
      x: 5,
      y: -7,
      w: 120,
      h: 80,
    });
  });

  it('does not mutate the node', () => {
    const n = deepFreeze(node('n1', { x: 1, y: 2, w: 3, h: 4 }));
    expect(nodeRect(n)).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });
});

describe('anchorPoint — fixed anchors are side midpoints', () => {
  it('top → (60, 20)', () => {
    expect(anchorPoint(R, 'top', { x: 0, y: 0 })).toEqual({ x: 60, y: 20 });
  });

  it('bottom → (60, 80)', () => {
    expect(anchorPoint(R, 'bottom', { x: 0, y: 0 })).toEqual({ x: 60, y: 80 });
  });

  it('left → (10, 50)', () => {
    expect(anchorPoint(R, 'left', { x: 0, y: 0 })).toEqual({ x: 10, y: 50 });
  });

  it('right → (110, 50)', () => {
    expect(anchorPoint(R, 'right', { x: 0, y: 0 })).toEqual({ x: 110, y: 50 });
  });

  it('fixed anchors ignore toward', () => {
    expect(anchorPoint(R, 'top', { x: 999, y: -999 })).toEqual({
      x: 60,
      y: 20,
    });
    expect(anchorPoint(R, 'left', { x: 999, y: -999 })).toEqual({
      x: 10,
      y: 50,
    });
  });
});

describe('anchorPoint — auto', () => {
  it('toward directly right gives the right-side midpoint', () => {
    const p = anchorPoint(R, 'auto', { x: 500, y: 50 });
    expect(p.x).toBeCloseTo(110, 10);
    expect(p.y).toBeCloseTo(50, 10);
  });

  it('toward directly left gives the left-side midpoint', () => {
    const p = anchorPoint(R, 'auto', { x: -500, y: 50 });
    expect(p.x).toBeCloseTo(10, 10);
    expect(p.y).toBeCloseTo(50, 10);
  });

  it('toward directly above gives the top-side midpoint', () => {
    const p = anchorPoint(R, 'auto', { x: 60, y: -500 });
    expect(p.x).toBeCloseTo(60, 10);
    expect(p.y).toBeCloseTo(20, 10);
  });

  it('toward directly below gives the bottom-side midpoint', () => {
    const p = anchorPoint(R, 'auto', { x: 60, y: 500 });
    expect(p.x).toBeCloseTo(60, 10);
    expect(p.y).toBeCloseTo(80, 10);
  });

  it('unit square {0,0,100,100} toward (200,200) gives (100,100)', () => {
    const p = anchorPoint({ x: 0, y: 0, w: 100, h: 100 }, 'auto', {
      x: 200,
      y: 200,
    });
    expect(p.x).toBeCloseTo(100, 10);
    expect(p.y).toBeCloseTo(100, 10);
  });

  it('rect {0,0,200,100} toward (400,100) gives (200, 66.667)', () => {
    const p = anchorPoint({ x: 0, y: 0, w: 200, h: 100 }, 'auto', {
      x: 400,
      y: 100,
    });
    expect(p.x).toBeCloseTo(200, 10);
    expect(p.y).toBeCloseTo(66.667, 3);
  });

  it('toward equal to the center gives the right-side midpoint', () => {
    const p = anchorPoint(R, 'auto', { x: 60, y: 50 });
    expect(p).toEqual({ x: 110, y: 50 });
  });

  it('does not mutate its inputs', () => {
    const rect = deepFreeze({ x: 0, y: 0, w: 100, h: 100 });
    const toward = deepFreeze({ x: 250, y: 250 });
    const p = anchorPoint(rect, 'auto', toward);
    expect(p.x).toBeCloseTo(100, 10);
    expect(p.y).toBeCloseTo(100, 10);
  });
});

describe('edgeEndpoints', () => {
  const RECTS: Record<string, Rect> = {
    a: { x: 0, y: 0, w: 200, h: 120 },
    b: { x: 400, y: 0, w: 200, h: 120 },
  };

  function rectOf(id: string): Rect | undefined {
    return RECTS[id];
  }

  function e(from: Anchor, to: Anchor): Edge {
    return {
      id: 'e1',
      from: { node: 'a', anchor: from },
      to: { node: 'b', anchor: to },
    };
  }

  it('auto/auto between two side-by-side rects gives the facing side midpoints', () => {
    expect(edgeEndpoints(e('auto', 'auto'), rectOf)).toEqual({
      from: { x: 200, y: 60 },
      to: { x: 400, y: 60 },
    });
  });

  it('fixed bottom → top crosses vertically', () => {
    expect(edgeEndpoints(e('bottom', 'top'), rectOf)).toEqual({
      from: { x: 100, y: 120 },
      to: { x: 500, y: 0 },
    });
  });

  it('one auto and one fixed', () => {
    // from: auto on A toward B's center (500,60) → right side (200,60).
    // to: fixed left on B → (400, 60).
    expect(edgeEndpoints(e('auto', 'left'), rectOf)).toEqual({
      from: { x: 200, y: 60 },
      to: { x: 400, y: 60 },
    });
    // from: fixed right on A → (200, 60); to: auto on B toward A's center.
    expect(edgeEndpoints(e('right', 'auto'), rectOf)).toEqual({
      from: { x: 200, y: 60 },
      to: { x: 400, y: 60 },
    });
  });

  it('a missing from-node rect gives null', () => {
    expect(
      edgeEndpoints(e('auto', 'auto'), (id) =>
        id === 'b' ? RECTS.b : undefined,
      ),
    ).toBeNull();
  });

  it('a missing to-node rect gives null', () => {
    expect(
      edgeEndpoints(e('auto', 'auto'), (id) =>
        id === 'a' ? RECTS.a : undefined,
      ),
    ).toBeNull();
  });

  it('does not mutate the edge or the rects', () => {
    const frozenEdge = deepFreeze(e('auto', 'auto'));
    const frozenRects: Record<string, Rect> = deepFreeze({
      a: { x: 0, y: 0, w: 10, h: 10 },
      b: { x: 50, y: 0, w: 10, h: 10 },
    });
    const p = edgeEndpoints(frozenEdge, (id) => frozenRects[id]);
    expect(p).toEqual({ from: { x: 10, y: 5 }, to: { x: 50, y: 5 } });
  });
});

// --- Seeded properties (T-009 R5) ---

const PROP_SEED = 0x7e57e9de;
const PROP_RUNS = 200;
const ANCHORS: Anchor[] = ['auto', 'top', 'right', 'bottom', 'left'];
const FIXED_ANCHORS: Anchor[] = ['top', 'right', 'bottom', 'left'];

function randomRect(rng: () => number): Rect {
  return {
    x: randInt(rng, -10000, 10000),
    y: randInt(rng, -10000, 10000),
    w: randInt(rng, 20, 400),
    h: randInt(rng, 20, 400),
  };
}

function mkEdge(from: Anchor, to: Anchor): Edge {
  return {
    id: 'e',
    from: { node: 'a', anchor: from },
    to: { node: 'b', anchor: to },
  };
}

function rectsToRectOf(a: Rect, b: Rect): (id: string) => Rect | undefined {
  return (id) => (id === 'a' ? a : id === 'b' ? b : undefined);
}

function translated(r: Rect, t: Point): Rect {
  return { x: r.x + t.x, y: r.y + t.y, w: r.w, h: r.h };
}

/** max(|px − cx| / hx, |py − cy| / hy) — 1 exactly on the rect boundary. */
function boundaryRatio(r: Rect, p: Point): number {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return Math.max(
    Math.abs(p.x - cx) / (r.w / 2),
    Math.abs(p.y - cy) / (r.h / 2),
  );
}

describe('edge geometry — seeded properties (200 runs × 25 anchor pairs)', () => {
  it('(a) every endpoint lies on its own rect boundary and is finite', () => {
    for (let run = 0; run < PROP_RUNS; run++) {
      const rng = mulberry32(PROP_SEED + run);
      const a = randomRect(rng);
      const b = randomRect(rng);
      for (const fa of ANCHORS) {
        for (const ta of ANCHORS) {
          const p = edgeEndpoints(mkEdge(fa, ta), rectsToRectOf(a, b))!;
          expect(Number.isFinite(p.from.x)).toBe(true);
          expect(Number.isFinite(p.from.y)).toBe(true);
          expect(Number.isFinite(p.to.x)).toBe(true);
          expect(Number.isFinite(p.to.y)).toBe(true);
          expect(Math.abs(boundaryRatio(a, p.from) - 1)).toBeLessThanOrEqual(
            1e-9,
          );
          expect(Math.abs(boundaryRatio(b, p.to) - 1)).toBeLessThanOrEqual(
            1e-9,
          );
        }
      }
    }
  });

  it('(b) swapping from and to (and their anchors) swaps the endpoints', () => {
    for (let run = 0; run < PROP_RUNS; run++) {
      const rng = mulberry32(PROP_SEED + run);
      const a = randomRect(rng);
      const b = randomRect(rng);
      const rectOf = rectsToRectOf(a, b);
      for (const fa of ANCHORS) {
        for (const ta of ANCHORS) {
          const e1 = mkEdge(fa, ta);
          const e2: Edge = {
            id: 'e2',
            from: { node: 'b', anchor: ta },
            to: { node: 'a', anchor: fa },
          };
          const p1 = edgeEndpoints(e1, rectOf)!;
          const p2 = edgeEndpoints(e2, rectOf)!;
          expect(p2.from).toEqual(p1.to);
          expect(p2.to).toEqual(p1.from);
        }
      }
    }
  });

  it('(c) translating both rects by t translates both endpoints by t', () => {
    for (let run = 0; run < PROP_RUNS; run++) {
      const rng = mulberry32(PROP_SEED + run);
      const a = randomRect(rng);
      const b = randomRect(rng);
      const t: Point = {
        x: randInt(rng, -500, 500),
        y: randInt(rng, -500, 500),
      };
      for (const fa of ANCHORS) {
        for (const ta of ANCHORS) {
          const edge = mkEdge(fa, ta);
          const p = edgeEndpoints(edge, rectsToRectOf(a, b))!;
          const pT = edgeEndpoints(
            edge,
            rectsToRectOf(translated(a, t), translated(b, t)),
          )!;
          expect(Math.abs(pT.from.x - (p.from.x + t.x))).toBeLessThanOrEqual(
            1e-9,
          );
          expect(Math.abs(pT.from.y - (p.from.y + t.y))).toBeLessThanOrEqual(
            1e-9,
          );
          expect(Math.abs(pT.to.x - (p.to.x + t.x))).toBeLessThanOrEqual(1e-9);
          expect(Math.abs(pT.to.y - (p.to.y + t.y))).toBeLessThanOrEqual(1e-9);
        }
      }
    }
  });

  it('(d) fixed anchors: translating only rect A moves the A endpoint by exactly t, B endpoint unchanged', () => {
    for (let run = 0; run < PROP_RUNS; run++) {
      const rng = mulberry32(PROP_SEED + run);
      const a = randomRect(rng);
      const b = randomRect(rng);
      const t: Point = {
        x: randInt(rng, -500, 500),
        y: randInt(rng, -500, 500),
      };
      for (const fa of FIXED_ANCHORS) {
        for (const ta of FIXED_ANCHORS) {
          const edge = mkEdge(fa, ta);
          const p = edgeEndpoints(edge, rectsToRectOf(a, b))!;
          const pT = edgeEndpoints(edge, rectsToRectOf(translated(a, t), b))!;
          // Exact: integer coordinates keep every intermediate representable.
          expect(pT.from).toEqual({ x: p.from.x + t.x, y: p.from.y + t.y });
          expect(pT.to).toEqual(p.to);
        }
      }
    }
  });
});
