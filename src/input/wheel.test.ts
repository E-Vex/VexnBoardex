import { describe, expect, it } from 'vitest';

import { ZOOM_SENSITIVITY, wheelDeltaToPixels, wheelToZoomFactor } from './wheel';

describe('wheelDeltaToPixels — mode scaling (R2)', () => {
  it('mode 0 (pixels) → ×1', () => {
    expect(wheelDeltaToPixels(100, 0)).toBe(100);
    expect(wheelDeltaToPixels(-50, 0)).toBe(-50);
  });

  it('mode 1 (lines) → ×16', () => {
    expect(wheelDeltaToPixels(3, 1)).toBe(48);
    expect(wheelDeltaToPixels(-2, 1)).toBe(-32);
  });

  it('mode 2 (pages) → ×400', () => {
    expect(wheelDeltaToPixels(1, 2)).toBe(400);
    expect(wheelDeltaToPixels(-1, 2)).toBe(-400);
  });

  it('any other mode → ×1', () => {
    expect(wheelDeltaToPixels(100, 99)).toBe(100);
    expect(wheelDeltaToPixels(100, -1)).toBe(100);
  });
});

describe('wheelToZoomFactor — known values (R2)', () => {
  it('wheelToZoomFactor(-100, 0) ≈ 1.2214', () => {
    expect(wheelToZoomFactor(-100, 0)).toBeCloseTo(1.2214, 4);
  });

  it('wheelToZoomFactor(100, 0) ≈ 0.8187', () => {
    expect(wheelToZoomFactor(100, 0)).toBeCloseTo(0.8187, 4);
  });

  it('scroll up (negative deltaY) → factor > 1', () => {
    expect(wheelToZoomFactor(-120, 0)).toBeGreaterThan(1);
  });

  it('scroll down (positive deltaY) → factor < 1', () => {
    expect(wheelToZoomFactor(120, 0)).toBeLessThan(1);
  });

  it('zero delta → factor 1', () => {
    expect(wheelToZoomFactor(0, 0)).toBe(1);
  });
});

describe('wheelToZoomFactor — clamping at 0.5 and 2', () => {
  it('very large negative delta clamps to 2', () => {
    expect(wheelToZoomFactor(-10000, 0)).toBe(2);
    expect(wheelToZoomFactor(-1, 2)).toBe(2); // -400 px → exp(0.8) > 2
  });

  it('very large positive delta clamps to 0.5', () => {
    expect(wheelToZoomFactor(10000, 0)).toBe(0.5);
    expect(wheelToZoomFactor(1, 2)).toBe(0.5); // 400 px → exp(-0.8) < 0.5
  });
});

describe('wheelToZoomFactor — non-finite → 1', () => {
  it('NaN deltaY → 1', () => {
    expect(wheelToZoomFactor(NaN, 0)).toBe(1);
  });

  it('Infinity deltaY → 1', () => {
    expect(wheelToZoomFactor(Infinity, 0)).toBe(1);
  });

  it('-Infinity deltaY → 1', () => {
    expect(wheelToZoomFactor(-Infinity, 0)).toBe(1);
  });
});

describe('wheelToZoomFactor — factor(d) × factor(−d) ≈ 1 for small d', () => {
  it('round-trips for a range of small deltas', () => {
    for (const d of [10, 20, 50, 80, 100, 120, 200]) {
      const f = wheelToZoomFactor(d, 0);
      const fInv = wheelToZoomFactor(-d, 0);
      expect(f * fInv).toBeCloseTo(1, 10);
    }
  });
});

describe('ZOOM_SENSITIVITY constant', () => {
  it('is 0.002 (R2)', () => {
    expect(ZOOM_SENSITIVITY).toBe(0.002);
  });
});
