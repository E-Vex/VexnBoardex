import { describe, expect, it } from 'vitest';

import type { Point } from '../core/geometry';
import { type Camera } from '../view/camera';
import { formatHud } from './hudFormat';

describe('formatHud — known values (brief R4)', () => {
  const cam: Camera = { x: -640, y: -360, zoom: 1 };

  it('zoom 1 → "100%"', () => {
    expect(formatHud(cam, null).zoom).toBe('100%');
  });

  it('cam {−640, −360, 1} → "cam -640.0, -360.0"', () => {
    expect(formatHud(cam, null).cam).toBe('-640.0, -360.0');
  });

  it('cursor (300, 200) → world "-340.0, -160.0", screen "300, 200"', () => {
    const cursor: Point = { x: 300, y: 200 };
    const hud = formatHud(cam, cursor);
    expect(hud.world).toBe('-340.0, -160.0');
    expect(hud.screen).toBe('300, 200');
  });
});

describe('formatHud — no cursor (brief R4)', () => {
  const cam: Camera = { x: -640, y: -360, zoom: 1 };

  it('world and screen are "—" when cursor is null', () => {
    const hud = formatHud(cam, null);
    expect(hud.world).toBe('—');
    expect(hud.screen).toBe('—');
  });

  it('zoom and cam are still shown', () => {
    const hud = formatHud(cam, null);
    expect(hud.zoom).toBe('100%');
    expect(hud.cam).toBe('-640.0, -360.0');
  });
});

describe('formatHud — zoom percent', () => {
  const cursor: Point = { x: 0, y: 0 };

  it('zoom 0.5 → "50%"', () => {
    expect(formatHud({ x: 0, y: 0, zoom: 0.5 }, cursor).zoom).toBe('50%');
  });

  it('zoom 2 → "200%"', () => {
    expect(formatHud({ x: 0, y: 0, zoom: 2 }, cursor).zoom).toBe('200%');
  });

  it('zoom 0.05 → "5%"', () => {
    expect(formatHud({ x: 0, y: 0, zoom: 0.05 }, cursor).zoom).toBe('5%');
  });

  it('zoom 8 → "800%"', () => {
    expect(formatHud({ x: 0, y: 0, zoom: 8 }, cursor).zoom).toBe('800%');
  });
});

describe('formatHud — -0 normalization (brief R4)', () => {
  it('cam at origin: "0.0, 0.0" (not "-0.0, -0.0")', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    expect(formatHud(cam, null).cam).toBe('0.0, 0.0');
  });

  it('world near origin with small negative: "0.0" not "-0.0"', () => {
    // cam at origin, cursor at (-0.04, 0): world = -0.04, 0 → "0.0, 0.0"
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const hud = formatHud(cam, { x: -0.04, y: 0 });
    expect(hud.world).toBe('0.0, 0.0');
  });

  it('screen near origin: "0, 0" not "-0, -0"', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const hud = formatHud(cam, { x: -0.3, y: -0.3 });
    // Math.round(-0.3) = -0, normalized to "0"
    expect(hud.screen).toBe('0, 0');
  });

  it('real negative values are preserved (not normalized)', () => {
    const cam: Camera = { x: -640, y: -360, zoom: 1 };
    const hud = formatHud(cam, { x: 300, y: 200 });
    expect(hud.cam).toBe('-640.0, -360.0');
    expect(hud.world).toBe('-340.0, -160.0');
  });
});

describe('formatHud — screen rounding', () => {
  const cam: Camera = { x: 0, y: 0, zoom: 1 };

  it('rounds to nearest integer', () => {
    expect(formatHud(cam, { x: 300.7, y: 200.3 }).screen).toBe('301, 200');
  });

  it('integer cursor is exact', () => {
    expect(formatHud(cam, { x: 652, y: 390 }).screen).toBe('652, 390');
  });
});
