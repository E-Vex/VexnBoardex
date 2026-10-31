// exportFrame unit tests (M8, T-027). Pure math: no DOM (D-06 spirit).
import { describe, expect, it } from 'vitest';

import { EXPORT_PADDING, EXPORT_SCALE, exportFrame } from './pngExport';

describe('exportFrame', () => {
  it('places the camera at the bounds top-left minus padding, at zoom = scale', () => {
    const frame = exportFrame({ x: -100, y: -60, w: 200, h: 120 });
    expect(frame.camera).toEqual({
      x: -100 - EXPORT_PADDING,
      y: -60 - EXPORT_PADDING,
      zoom: EXPORT_SCALE,
    });
  });

  it('sizes the canvas to (bounds + padding on both sides) × scale', () => {
    const frame = exportFrame({ x: 0, y: 0, w: 200, h: 120 });
    expect(frame.width).toBe((200 + 2 * EXPORT_PADDING) * EXPORT_SCALE);
    expect(frame.height).toBe((120 + 2 * EXPORT_PADDING) * EXPORT_SCALE);
  });

  it('honours explicit padding and scale', () => {
    const frame = exportFrame({ x: 10, y: 20, w: 30, h: 40 }, 5, 3);
    expect(frame.camera).toEqual({ x: 5, y: 15, zoom: 3 });
    expect(frame.width).toBe((30 + 10) * 3);
    expect(frame.height).toBe((40 + 10) * 3);
  });

  it('zero padding frames the bounds exactly', () => {
    const frame = exportFrame({ x: 7, y: 8, w: 9, h: 10 }, 0, 1);
    expect(frame.camera).toEqual({ x: 7, y: 8, zoom: 1 });
    expect(frame.width).toBe(9);
    expect(frame.height).toBe(10);
  });

  it('throws on non-finite bounds', () => {
    expect(() => exportFrame({ x: NaN, y: 0, w: 1, h: 1 })).toThrow();
    expect(() => exportFrame({ x: 0, y: Infinity, w: 1, h: 1 })).toThrow();
  });

  it('throws on a non-positive or non-finite scale', () => {
    expect(() => exportFrame({ x: 0, y: 0, w: 1, h: 1 }, 10, 0)).toThrow();
    expect(() => exportFrame({ x: 0, y: 0, w: 1, h: 1 }, 10, -2)).toThrow();
    expect(() => exportFrame({ x: 0, y: 0, w: 1, h: 1 }, 10, NaN)).toThrow();
  });

  it('every world point of the bounds maps inside the canvas (round trip)', () => {
    const bounds = { x: -1234.5, y: 99, w: 555, h: 4321 };
    const { camera, width, height } = exportFrame(bounds, 32, 2);
    // top-left of the bounds → padding × scale on canvas
    expect((bounds.x - camera.x) * camera.zoom).toBeCloseTo(32 * 2);
    expect((bounds.y - camera.y) * camera.zoom).toBeCloseTo(32 * 2);
    // bottom-right of the bounds → padding × scale from the far edge
    expect(width - (bounds.x + bounds.w - camera.x) * camera.zoom).toBeCloseTo(32 * 2);
    expect(height - (bounds.y + bounds.h - camera.y) * camera.zoom).toBeCloseTo(32 * 2);
  });
});
