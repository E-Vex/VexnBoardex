import { describe, expect, it } from 'vitest';

import type { Point } from '../core/geometry';
import {
  DEFAULT_CAMERA,
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  panBy,
  screenToWorld,
  visibleWorldRect,
  worldToScreen,
  zoomAt,
  zoomByFactorAt,
  type Camera,
} from './camera';

/**
 * The brief's tolerance (R4): |a − b| ≤ 1e-9 × max(1, |a|, |b|).
 */
function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

function closePoint(p: Point, q: Point): boolean {
  return close(p.x, q.x) && close(p.y, q.y);
}

function expectClosePoint(actual: Point, expected: Point): void {
  expect(
    closePoint(actual, expected),
    `expected (${actual.x}, ${actual.y}) ≈ (${expected.x}, ${expected.y})`,
  ).toBe(true);
}

function closeCamera(a: Camera, b: Camera): boolean {
  return close(a.x, b.x) && close(a.y, b.y) && close(a.zoom, b.zoom);
}

function expectCloseCamera(actual: Camera, expected: Camera): void {
  expect(
    closeCamera(actual, expected),
    `expected (${actual.x}, ${actual.y}, z=${actual.zoom}) ≈ ` +
      `(${expected.x}, ${expected.y}, z=${expected.zoom})`,
  ).toBe(true);
}

/**
 * Deterministic PRNG (mulberry32), written in-file per the brief — no new
 * dependencies. Every test seeds it explicitly, so any failure reproduces
 * exactly from the seed.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ZOOM_LOG_LOW = Math.log(MIN_ZOOM);
const ZOOM_LOG_HIGH = Math.log(MAX_ZOOM);

/** Log-uniform zoom over the full [MIN_ZOOM, MAX_ZOOM] range. */
function randomZoom(rand: () => number): number {
  return Math.exp(ZOOM_LOG_LOW + (ZOOM_LOG_HIGH - ZOOM_LOG_LOW) * rand());
}

/** Camera with offsets in ±offsetRange and a log-uniform zoom. */
function randomCamera(rand: () => number, offsetRange: number): Camera {
  return {
    x: (rand() * 2 - 1) * offsetRange,
    y: (rand() * 2 - 1) * offsetRange,
    zoom: randomZoom(rand),
  };
}

function randomPoint(rand: () => number, offsetRange: number): Point {
  return {
    x: (rand() * 2 - 1) * offsetRange,
    y: (rand() * 2 - 1) * offsetRange,
  };
}

describe('zoom constants (brief R1)', () => {
  it('exposes the locked zoom range and the identity camera', () => {
    expect(MIN_ZOOM).toBe(0.05);
    expect(MAX_ZOOM).toBe(8);
    expect(DEFAULT_CAMERA).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});

describe('clampZoom (brief R4.11)', () => {
  it('clamps values below MIN_ZOOM up to MIN_ZOOM', () => {
    expect(clampZoom(0.001)).toBe(MIN_ZOOM);
    expect(clampZoom(-1)).toBe(MIN_ZOOM);
  });

  it('clamps values above MAX_ZOOM down to MAX_ZOOM', () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(9)).toBe(MAX_ZOOM);
  });

  it('passes in-range values through unchanged', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(3.7)).toBe(3.7);
  });

  it('bounds are inclusive', () => {
    expect(clampZoom(MIN_ZOOM)).toBe(MIN_ZOOM);
    expect(clampZoom(MAX_ZOOM)).toBe(MAX_ZOOM);
  });
});

describe('worldToScreen / screenToWorld — known values (brief R4.1)', () => {
  const cam: Camera = { x: 100, y: 50, zoom: 2 };

  it('worldToScreen({100, 50}) = {0, 0}', () => {
    expectClosePoint(worldToScreen(cam, { x: 100, y: 50 }), { x: 0, y: 0 });
  });

  it('worldToScreen({110, 60}) = {20, 20}', () => {
    expectClosePoint(worldToScreen(cam, { x: 110, y: 60 }), { x: 20, y: 20 });
  });

  it('screenToWorld({0, 0}) = {100, 50}', () => {
    expectClosePoint(screenToWorld(cam, { x: 0, y: 0 }), { x: 100, y: 50 });
  });
});

describe('panBy (brief R4.7)', () => {
  const rand = mulberry32(0x5eed02);

  it('moves the world point under s0 to s0 + d, zoom unchanged', () => {
    for (let i = 0; i < 200; i++) {
      const cam = randomCamera(rand, 1e4);
      const s0 = randomPoint(rand, 1e3);
      const d = randomPoint(rand, 100);
      const worldBefore = screenToWorld(cam, s0);
      const panned = panBy(cam, d.x, d.y);
      const worldAfter = screenToWorld(panned, {
        x: s0.x + d.x,
        y: s0.y + d.y,
      });
      expectClosePoint(worldAfter, worldBefore);
      expect(panned.zoom).toBe(cam.zoom);
    }
  });

  it('returns a new object, never the mutated input', () => {
    const cam: Camera = { x: 10, y: 20, zoom: 2 };
    const panned = panBy(cam, 5, -5);
    expect(panned).not.toBe(cam);
    expect(cam).toEqual({ x: 10, y: 20, zoom: 2 });
  });

  it('non-finite deltas are a no-op: camera returned unchanged', () => {
    const cam: Camera = { x: 10, y: 20, zoom: 2 };
    for (const bad of [NaN, Infinity, -Infinity]) {
      expectCloseCamera(panBy(cam, bad, 1), cam);
      expectCloseCamera(panBy(cam, 1, bad), cam);
    }
  });

  it('a camera with a non-finite field is returned unchanged (no-op)', () => {
    for (const key of ['x', 'y', 'zoom'] as const) {
      const cam: Camera = { x: 10, y: 20, zoom: 2 };
      cam[key] = NaN;
      // Unchanged means unchanged: the same camera, nothing computed.
      expect(panBy(cam, 5, 5)).toBe(cam);
    }
  });

  it('a camera with zoom ≤ 0 is returned unchanged (never NaN)', () => {
    const zero: Camera = { x: 10, y: 20, zoom: 0 };
    const negative: Camera = { x: 10, y: 20, zoom: -2 };
    expectCloseCamera(panBy(zero, 0, 0), { x: 10, y: 20, zoom: 0 });
    expectCloseCamera(panBy(negative, 5, 5), { x: 10, y: 20, zoom: -2 });
  });

  it('frozen camera input works and is not mutated', () => {
    const cam: Camera = Object.freeze({ x: 10, y: 20, zoom: 2 });
    const panned = panBy(cam, 8, 4);
    expectCloseCamera(panned, { x: 6, y: 18, zoom: 2 });
    expect(Object.isFrozen(cam)).toBe(true);
    expect(panned).not.toBe(cam);
  });
});

describe('zoomAt — the anchor stays fixed (brief R4.3)', () => {
  const rand = mulberry32(0x5eed03);

  it('worldToScreen(zoomAt(cam, s, z), screenToWorld(cam, s)) = s', () => {
    for (let i = 0; i < 200; i++) {
      const cam = randomCamera(rand, 1e4);
      const s = randomPoint(rand, 1e3);
      const target = randomZoom(rand);
      const zoomed = zoomAt(cam, s, target);
      const anchor = screenToWorld(cam, s);
      expectClosePoint(worldToScreen(zoomed, anchor), s);
      expect(zoomed.zoom).toBe(clampZoom(target));
    }
  });
});

describe('zoomAt — clamping (brief R4.4)', () => {
  const rand = mulberry32(0x5eed04);

  it('requesting 100 clamps to MAX_ZOOM and keeps the cursor point fixed', () => {
    for (let i = 0; i < 50; i++) {
      const cam = randomCamera(rand, 1e4);
      const s = randomPoint(rand, 1e3);
      const zoomed = zoomAt(cam, s, 100);
      expect(zoomed.zoom).toBe(MAX_ZOOM);
      expectClosePoint(worldToScreen(zoomed, screenToWorld(cam, s)), s);
    }
  });

  it('requesting 0.001 clamps to MIN_ZOOM and keeps the cursor point fixed', () => {
    for (let i = 0; i < 50; i++) {
      const cam = randomCamera(rand, 1e4);
      const s = randomPoint(rand, 1e3);
      const zoomed = zoomAt(cam, s, 0.001);
      expect(zoomed.zoom).toBe(MIN_ZOOM);
      expectClosePoint(worldToScreen(zoomed, screenToWorld(cam, s)), s);
    }
  });
});

describe('zoomAt — already at the bounds (brief R4.5)', () => {
  const rand = mulberry32(0x5eed05);

  it('zooming in further at MAX_ZOOM leaves the camera equal within tolerance', () => {
    for (let i = 0; i < 50; i++) {
      const cam = randomCamera(rand, 1e4);
      cam.zoom = MAX_ZOOM;
      const s = randomPoint(rand, 1e3);
      expectCloseCamera(zoomAt(cam, s, MAX_ZOOM * 4), cam);
    }
  });

  it('zooming out further at MIN_ZOOM leaves the camera equal within tolerance', () => {
    for (let i = 0; i < 50; i++) {
      const cam = randomCamera(rand, 1e4);
      cam.zoom = MIN_ZOOM;
      const s = randomPoint(rand, 1e3);
      expectCloseCamera(zoomAt(cam, s, MIN_ZOOM / 10), cam);
    }
  });
});

describe('zoomByFactorAt — reversibility (brief R4.6)', () => {
  const rand = mulberry32(0x5eed06);

  it('×2 then ×0.5 restores the camera when no clamping occurs', () => {
    for (let i = 0; i < 200; i++) {
      // zoom in [0.2, 3.5] so ×2 never clamps up and the intermediate
      // zoom ×0.5 never clamps down.
      const cam: Camera = {
        x: (rand() * 2 - 1) * 1e4,
        y: (rand() * 2 - 1) * 1e4,
        zoom: Math.exp(
          Math.log(0.2) + (Math.log(3.5) - Math.log(0.2)) * rand(),
        ),
      };
      const s = randomPoint(rand, 1e3);
      const zoomed = zoomByFactorAt(zoomByFactorAt(cam, s, 2), s, 0.5);
      expectCloseCamera(zoomed, cam);
    }
  });
});

describe('non-finite inputs are no-ops (brief R4.9)', () => {
  const cam: Camera = { x: 10, y: 20, zoom: 2 };
  const s: Point = { x: 30, y: 40 };

  it('zoomAt: non-finite point or zoom returns the camera unchanged', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(zoomAt(cam, { x: bad, y: 1 }, 3)).toBe(cam);
      expect(zoomAt(cam, { x: 1, y: bad }, 3)).toBe(cam);
      expect(zoomAt(cam, s, bad)).toBe(cam);
    }
  });

  it('zoomByFactorAt: factor NaN, ±Infinity or ≤ 0 returns it unchanged', () => {
    for (const bad of [NaN, Infinity, -Infinity, 0, -1, -0.5]) {
      expect(zoomByFactorAt(cam, s, bad)).toBe(cam);
    }
  });

  it('results contain no NaN for valid inputs', () => {
    for (const r of [
      panBy(cam, 3, 4),
      zoomAt(cam, s, 3),
      zoomByFactorAt(cam, s, 1.5),
    ]) {
      expect(Number.isFinite(r.x)).toBe(true);
      expect(Number.isFinite(r.y)).toBe(true);
      expect(Number.isFinite(r.zoom)).toBe(true);
    }
  });
});

describe('immutability (brief R4.10)', () => {
  it('frozen camera and point work; every function returns a new object', () => {
    const cam: Camera = Object.freeze({ x: 100, y: 50, zoom: 2 });
    const s: Point = Object.freeze({ x: 20, y: 10 });
    const before = { ...cam };

    const panned = panBy(cam, 10, 10);
    const zoomed = zoomAt(cam, s, 4);
    const factored = zoomByFactorAt(cam, s, 0.5);

    expect(Object.isFrozen(cam)).toBe(true);
    expect(cam).toEqual(before);
    expect(panned).not.toBe(cam);
    expect(zoomed).not.toBe(cam);
    expect(factored).not.toBe(cam);
    // Known value: anchor (110, 55), zoom 4 → (110 − 20/4, 55 − 10/4, 4).
    expectCloseCamera(zoomed, { x: 105, y: 52.5, zoom: 4 });
  });

  it('DEFAULT_CAMERA is never mutated by the functions', () => {
    const before = { ...DEFAULT_CAMERA };
    panBy(DEFAULT_CAMERA, 100, 100);
    zoomAt(DEFAULT_CAMERA, { x: 50, y: 50 }, 8);
    zoomByFactorAt(DEFAULT_CAMERA, { x: 50, y: 50 }, 2);
    expect(DEFAULT_CAMERA).toEqual(before);
  });
});

describe('visibleWorldRect (brief R4.8)', () => {
  it('known value: cam {−50, 20, zoom 2}, 800×600 → {−50, 20, 400, 300}', () => {
    const cam: Camera = { x: -50, y: 20, zoom: 2 };
    expect(visibleWorldRect(cam, 800, 600)).toEqual({
      x: -50,
      y: 20,
      w: 400,
      h: 300,
    });
  });

  it('corners agree with screenToWorld of the viewport corners', () => {
    const rand = mulberry32(0x5eed07);
    for (let i = 0; i < 100; i++) {
      const cam = randomCamera(rand, 1e5);
      const w = 200 + rand() * 2000;
      const h = 200 + rand() * 2000;
      const rect = visibleWorldRect(cam, w, h);
      expectClosePoint(
        { x: rect.x, y: rect.y },
        screenToWorld(cam, { x: 0, y: 0 }),
      );
      expectClosePoint(
        { x: rect.x + rect.w, y: rect.y + rect.h },
        screenToWorld(cam, { x: w, y: h }),
      );
    }
  });
});

describe('round trips — 200 seeded random cameras and points (brief R4.2)', () => {
  const rand = mulberry32(0x5eed01);
  const cameras = Array.from({ length: 200 }, () => randomCamera(rand, 1e5));
  const worldPoints = Array.from({ length: 200 }, () => randomPoint(rand, 1e5));
  const screenPoints = Array.from({ length: 200 }, () => randomPoint(rand, 1e5));

  it('world → screen → world restores the world point', () => {
    for (const cam of cameras) {
      for (const p of worldPoints) {
        expectClosePoint(screenToWorld(cam, worldToScreen(cam, p)), p);
      }
    }
  });

  it('screen → world → screen restores the screen point', () => {
    for (const cam of cameras) {
      for (const s of screenPoints) {
        expectClosePoint(worldToScreen(cam, screenToWorld(cam, s)), s);
      }
    }
  });
});
