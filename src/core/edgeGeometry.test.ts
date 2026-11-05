/**
 * Unit and seeded property tests for edge geometry (T-009 R5, PLAN D-31).
 *
 * Fixed anchors are side midpoints; `auto` is where the center-to-center
 * ray leaves the rectangle. Properties: endpoints lie on the rect boundary,
 * swapping the ends swaps the endpoints, translation commutes, and (for
 * fixed anchors) moving one rect moves only its own endpoint.
 */

import { describe, expect, it } from 'vitest';

import type { Anchor, Edge, EdgeRoute, Node } from './types';
import {
  anchorPoint,
  edgeEndpoints,
  edgePoints,
  elbow,
  nodeRect,
  orthogonalSide,
  polylineDistance,
  polylineMidpoint,
  type Side,
} from './edgeGeometry';
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

// --- T-033: orthogonal routing ---

describe('orthogonalSide — dominant-axis side selection (T-033)', () => {
  it('picks the right side when the other node is mostly to the right', () => {
    expect(orthogonalSide(R, { x: 500, y: 49 })).toBe('right');
  });

  it('picks the left side when the other node is mostly to the left', () => {
    expect(orthogonalSide(R, { x: -400, y: 51 })).toBe('left');
  });

  it('picks the bottom side when the other node is mostly below', () => {
    expect(orthogonalSide(R, { x: 61, y: 400 })).toBe('bottom');
  });

  it('picks the top side when the other node is mostly above', () => {
    expect(orthogonalSide(R, { x: 59, y: -300 })).toBe('top');
  });

  it('an exact diagonal prefers the horizontal side (|dx| >= |dy|)', () => {
    // Center (60, 50); toward (360, 350): dx = 300, dy = 300.
    expect(orthogonalSide(R, { x: 360, y: 350 })).toBe('right');
    expect(orthogonalSide(R, { x: -240, y: -250 })).toBe('left');
  });

  it('coincident centers fall back to right (D-31 fallback)', () => {
    expect(orthogonalSide(R, { x: 60, y: 50 })).toBe('right');
  });
});

describe('elbow — every segment is axis-aligned (T-033)', () => {
  const P0: Point = { x: 10, y: 10 };
  const P1: Point = { x: 400, y: 300 };

  it('horizontal → horizontal is a Z through the mid-x', () => {
    expect(elbow(P0, 'right', P1, 'left')).toEqual([
      { x: 10, y: 10 },
      { x: 205, y: 10 },
      { x: 205, y: 300 },
      { x: 400, y: 300 },
    ]);
  });

  it('vertical → vertical is a Z through the mid-y', () => {
    expect(elbow(P0, 'bottom', P1, 'top')).toEqual([
      { x: 10, y: 10 },
      { x: 10, y: 155 },
      { x: 400, y: 155 },
      { x: 400, y: 300 },
    ]);
  });

  it('horizontal → vertical is an L at (to.x, from.y)', () => {
    expect(elbow(P0, 'right', P1, 'top')).toEqual([
      { x: 10, y: 10 },
      { x: 400, y: 10 },
      { x: 400, y: 300 },
    ]);
  });

  it('vertical → horizontal is an L at (from.x, to.y)', () => {
    expect(elbow(P0, 'bottom', P1, 'left')).toEqual([
      { x: 10, y: 10 },
      { x: 10, y: 300 },
      { x: 400, y: 300 },
    ]);
  });

  it('every one of the four side combinations is axis-aligned end to end', () => {
    const sides: Side[] = ['top', 'right', 'bottom', 'left'];
    for (const a of sides) {
      for (const b of sides) {
        const pts = elbow(P0, a, P1, b);
        expect(pts[0]).toEqual(P0);
        expect(pts[pts.length - 1]).toEqual(P1);
        for (let i = 1; i < pts.length; i++) {
          const dx = pts[i]!.x - pts[i - 1]!.x;
          const dy = pts[i]!.y - pts[i - 1]!.y;
          expect(dx === 0 || dy === 0).toBe(true);
        }
      }
    }
  });
});

describe('edgePoints — route-aware polyline (T-033)', () => {
  const RECTS: Record<string, Rect> = {
    a: { x: 0, y: 0, w: 200, h: 120 },
    b: { x: 400, y: 300, w: 200, h: 120 },
  };

  function rectOf(id: string): Rect | undefined {
    return RECTS[id];
  }

  function e(
    from: Anchor,
    to: Anchor,
    route?: EdgeRoute,
  ): Edge {
    return {
      id: 'e1',
      from: { node: 'a', anchor: from },
      to: { node: 'b', anchor: to },
      ...(route !== undefined ? { route } : {}),
    };
  }

  it('an absent route is the classic two-point arrow (pixel-identical, I-08)', () => {
    const p = edgePoints(e('auto', 'auto'), rectOf)!;
    const q = edgeEndpoints(e('auto', 'auto'), rectOf)!;
    expect(p).toEqual([q.from, q.to]);
  });

  it("routes 'auto' and 'straight' both draw the two-point arrow", () => {
    for (const route of ['auto', 'straight'] as const) {
      const p = edgePoints(e('auto', 'auto', route), rectOf)!;
      const q = edgeEndpoints(e('auto', 'auto'), rectOf)!;
      expect(p).toEqual([q.from, q.to]);
    }
  });

  it('orthogonal resolves fixed anchors to their side midpoints', () => {
    // from: fixed right on A → (200, 60); to: fixed top on B → (500, 300).
    // Horizontal leave, vertical arrival: L with the corner at (500, 60).
    expect(edgePoints(e('right', 'top', 'orthogonal'), rectOf)).toEqual([
      { x: 200, y: 60 },
      { x: 500, y: 60 },
      { x: 500, y: 300 },
    ]);
  });

  it('orthogonal resolves auto anchors by the dominant axis (render-time side selection)', () => {
    // A center (100, 60), B center (500, 360): dx = 400 > dy = 300.
    // from → 'right' (200, 60); to → 'left' (400, 360). H → H Z route.
    expect(edgePoints(e('auto', 'auto', 'orthogonal'), rectOf)).toEqual([
      { x: 200, y: 60 },
      { x: 300, y: 60 },
      { x: 300, y: 360 },
      { x: 400, y: 360 },
    ]);
  });

  it('a missing rect gives null', () => {
    expect(edgePoints(e('auto', 'auto', 'orthogonal'), (id) =>
      id === 'a' ? RECTS.a : undefined,
    )).toBeNull();
  });

  it('does not mutate the edge or the rects', () => {
    const frozenEdge = deepFreeze(e('auto', 'auto', 'orthogonal'));
    const frozenRects: Record<string, Rect> = deepFreeze({
      a: { x: 0, y: 0, w: 10, h: 10 },
      b: { x: 50, y: 40, w: 10, h: 10 },
    });
    const pts = edgePoints(frozenEdge, (id) => frozenRects[id])!;
    expect(pts.length).toBeGreaterThanOrEqual(2);
  });

  it('every orthogonal segment is axis-aligned for all 25 anchor pairs (seeded)', () => {
    for (let run = 0; run < 25; run++) {
      const rng = mulberry32(PROP_SEED + run);
      const a = randomRect(rng);
      const b = randomRect(rng);
      const rectOf = rectsToRectOf(a, b);
      for (const fa of ANCHORS) {
        for (const ta of ANCHORS) {
          const pts = edgePoints(
            { ...mkEdge(fa, ta), route: 'orthogonal' },
            rectOf,
          )!;
          expect(pts.length).toBeGreaterThanOrEqual(2);
          for (let i = 1; i < pts.length; i++) {
            const dx = pts[i]!.x - pts[i - 1]!.x;
            const dy = pts[i]!.y - pts[i - 1]!.y;
            expect(dx === 0 || dy === 0).toBe(true);
          }
        }
      }
    }
  });

  it('orthogonal endpoints are side midpoints: on the rect boundary (seeded)', () => {
    for (let run = 0; run < 25; run++) {
      const rng = mulberry32(PROP_SEED + run);
      const a = randomRect(rng);
      const b = randomRect(rng);
      const rectOf = rectsToRectOf(a, b);
      for (const fa of FIXED_ANCHORS) {
        for (const ta of FIXED_ANCHORS) {
          const pts = edgePoints(
            { ...mkEdge(fa, ta), route: 'orthogonal' },
            rectOf,
          )!;
          expect(Math.abs(boundaryRatio(a, pts[0]!) - 1)).toBeLessThanOrEqual(1e-9);
          expect(
            Math.abs(boundaryRatio(b, pts[pts.length - 1]!) - 1),
          ).toBeLessThanOrEqual(1e-9);
        }
      }
    }
  });
});

describe('polylineDistance — nearest segment wins (T-033)', () => {
  const Z: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  it('a point on a segment has distance 0', () => {
    expect(polylineDistance(Z, { x: 40, y: 0 })).toBe(0);
    expect(polylineDistance(Z, { x: 100, y: 60 })).toBe(0);
  });

  it('measures the perpendicular distance to the nearest segment', () => {
    expect(polylineDistance(Z, { x: 40, y: 30 })).toBe(30);
  });

  it('clamps to segment endpoints', () => {
    expect(polylineDistance(Z, { x: -30, y: -40 })).toBe(50);
  });

  it('the vertical segment of the Z is nearer than the horizontal one', () => {
    // (130, 80) is 30 from the vertical segment, sqrt(30² + 80²) from the
    // horizontal one.
    expect(polylineDistance(Z, { x: 130, y: 80 })).toBe(30);
  });

  it('fewer than two points is unreachable (Infinity)', () => {
    expect(polylineDistance([{ x: 0, y: 0 }], { x: 0, y: 0 })).toBe(Infinity);
    expect(polylineDistance([], { x: 0, y: 0 })).toBe(Infinity);
  });
});

describe('polylineMidpoint — half the arc length (T-033)', () => {
  it('a two-point line keeps the segment midpoint (T-010 labels unchanged)', () => {
    expect(polylineMidpoint([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toEqual({
      x: 50,
      y: 0,
    });
  });

  it('an even L bends at its corner', () => {
    // Both legs are 100 long: half the arc is exactly the corner.
    const mid = polylineMidpoint([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
    expect(mid).toEqual({ x: 100, y: 0 });
  });

  it('an uneven L lands on the longer leg', () => {
    // Legs 300 and 100: half the arc (200) falls on the first leg at x=200.
    const mid = polylineMidpoint([
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 100 },
    ]);
    expect(mid).toEqual({ x: 200, y: 0 });
  });

  it('a Z lands on the vertical middle segment', () => {
    // Segments: 100, 100, 100 — total 300, half 150 → 50 down the middle.
    const mid = polylineMidpoint([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
    expect(mid).toEqual({ x: 100, y: 50 });
  });
});
