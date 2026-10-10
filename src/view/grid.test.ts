import { describe, expect, it } from 'vitest';

import {
  BASE_STEP,
  MIN_ONSCREEN_SPACING,
  dotCount,
  dotIndexRange,
  gridStep,
} from './grid';

/**
 * Tolerance for floating-point comparisons in the on-screen spacing checks
 * (brief R8: "tolerate floating error").
 */
const EPS = 1e-9;

describe('gridStep — invalid zoom returns BASE_STEP (24)', () => {
  it('NaN returns 24', () => {
    expect(gridStep(NaN)).toBe(BASE_STEP);
  });

  it('zero returns 24', () => {
    expect(gridStep(0)).toBe(BASE_STEP);
  });

  it('negative returns 24', () => {
    expect(gridStep(-1)).toBe(BASE_STEP);
    expect(gridStep(-0.5)).toBe(BASE_STEP);
  });

  it('±Infinity returns 24', () => {
    expect(gridStep(Infinity)).toBe(BASE_STEP);
    expect(gridStep(-Infinity)).toBe(BASE_STEP);
  });
});

describe('gridStep — on-screen spacing in [16, 32) for zoom [0.05, 8]', () => {
  // 41 log-spaced zoom samples from 0.05 to 8 (inclusive).
  const zooms: number[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    zooms.push(0.05 * Math.pow(8 / 0.05, t));
  }

  it('step × zoom ≥ 16', () => {
    for (const z of zooms) {
      const onScreen = gridStep(z) * z;
      expect(onScreen).toBeGreaterThanOrEqual(MIN_ONSCREEN_SPACING - EPS);
    }
  });

  it('step × zoom < 32 (within tolerance)', () => {
    for (const z of zooms) {
      const onScreen = gridStep(z) * z;
      expect(onScreen).toBeLessThan(32 + EPS);
    }
  });
});

describe('gridStep — step is always BASE_STEP × 2^k', () => {
  const zooms = [
    0.05, 0.07, 0.1, 0.15, 0.25, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 3.7, 5, 8,
  ];

  it('step / BASE_STEP is a positive power of 2', () => {
    for (const z of zooms) {
      const ratio = gridStep(z) / BASE_STEP;
      expect(ratio).toBeGreaterThan(0);
      const log = Math.log2(ratio);
      expect(Math.abs(log - Math.round(log))).toBeLessThan(1e-9);
    }
  });
});

describe('gridStep — step never increases as zoom increases', () => {
  it('monotonically non-increasing over log-spaced zoom [0.05, 8]', () => {
    const zooms: number[] = [];
    for (let i = 0; i <= 200; i++) {
      const t = i / 200;
      zooms.push(0.05 * Math.pow(8 / 0.05, t));
    }
    let prev = gridStep(zooms[0]!);
    for (let i = 1; i < zooms.length; i++) {
      const step = gridStep(zooms[i]!);
      expect(step).toBeLessThanOrEqual(prev);
      prev = step;
    }
  });
});

describe('gridStep — known values', () => {
  it('zoom 1 → step 24', () => {
    expect(gridStep(1)).toBe(24);
  });

  it('zoom 0.5 → step 48', () => {
    expect(gridStep(0.5)).toBe(48);
  });

  it('zoom 8 → step 3', () => {
    expect(gridStep(8)).toBe(3);
  });

  it('zoom 0.05 → step 384', () => {
    expect(gridStep(0.05)).toBe(384);
  });
});

describe('dotIndexRange — known cases', () => {
  it('rect {−50, −50, 100, 100}, step 24 → i0=−2, i1=2', () => {
    const range = dotIndexRange({ x: -50, y: -50, w: 100, h: 100 }, 24);
    expect(range).toEqual({ i0: -2, i1: 2, j0: -2, j1: 2 });
  });

  it('rect at origin {0, 0, 100, 100}, step 24 → i0=0, i1=4', () => {
    const range = dotIndexRange({ x: 0, y: 0, w: 100, h: 100 }, 24);
    expect(range).toEqual({ i0: 0, i1: 4, j0: 0, j1: 4 });
  });

  it('rect exactly covering one cell {0, 0, 24, 24}, step 24 → i0=0, i1=1', () => {
    const range = dotIndexRange({ x: 0, y: 0, w: 24, h: 24 }, 24);
    expect(range).toEqual({ i0: 0, i1: 1, j0: 0, j1: 1 });
  });
});

describe('dotCount — known values', () => {
  it('5×5 range → 25', () => {
    expect(dotCount({ i0: -2, i1: 2, j0: -2, j1: 2 })).toBe(25);
  });

  it('single dot (i0=i1, j0=j1) → 1', () => {
    expect(dotCount({ i0: 3, i1: 3, j0: 5, j1: 5 })).toBe(1);
  });

  it('empty range (i1 < i0) → 0', () => {
    expect(dotCount({ i0: 5, i1: 3, j0: 0, j1: 0 })).toBe(0);
  });

  it('empty range (j1 < j0) → 0', () => {
    expect(dotCount({ i0: 0, i1: 0, j0: 5, j1: 3 })).toBe(0);
  });

  it('large range: 100×100 → 10000', () => {
    expect(dotCount({ i0: 0, i1: 99, j0: 0, j1: 99 })).toBe(10000);
  });
});
