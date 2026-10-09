import { describe, expect, it } from 'vitest';

import { DEFAULT_CAMERA, MAX_ZOOM, MIN_ZOOM, clampZoom } from './camera';

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
