import { describe, expect, it } from 'vitest';

import type { Point } from '../core/geometry';
import {
  DEFAULT_CAMERA,
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  panBy,
  screenToWorld,
  worldToScreen,
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
