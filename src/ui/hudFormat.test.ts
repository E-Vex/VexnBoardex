import { describe, expect, it } from 'vitest';

import type { Point } from '../core/geometry';
import { type Camera } from '../view/camera';
import { formatHud } from './hudFormat';

describe('formatHud — known values (brief R4)', () => {
  const cam: Camera = { x: -640, y: -360, zoom: 1 };

  it('zoom 1 → "100%"', () => {
    expect(formatHud(cam, null, 0, 0, 0).zoom).toBe('100%');
  });

  it('cam {−640, −360, 1} → "cam -640.0, -360.0"', () => {
    expect(formatHud(cam, null, 0, 0, 0).cam).toBe('-640.0, -360.0');
  });

  it('cursor (300, 200) → world "-340.0, -160.0", screen "300, 200"', () => {
    const cursor: Point = { x: 300, y: 200 };
    const hud = formatHud(cam, cursor, 0, 0, 0);
    expect(hud.world).toBe('-340.0, -160.0');
    expect(hud.screen).toBe('300, 200');
  });
});

describe('formatHud — no cursor (brief R4)', () => {
  const cam: Camera = { x: -640, y: -360, zoom: 1 };

  it('world and screen are "—" when cursor is null', () => {
    const hud = formatHud(cam, null, 0, 0, 0);
    expect(hud.world).toBe('—');
    expect(hud.screen).toBe('—');
  });

  it('zoom and cam are still shown', () => {
    const hud = formatHud(cam, null, 0, 0, 0);
    expect(hud.zoom).toBe('100%');
    expect(hud.cam).toBe('-640.0, -360.0');
  });
});

describe('formatHud — zoom percent', () => {
  const cursor: Point = { x: 0, y: 0 };

  it('zoom 0.5 → "50%"', () => {
    expect(formatHud({ x: 0, y: 0, zoom: 0.5 }, cursor, 0, 0, 0).zoom).toBe('50%');
  });

  it('zoom 2 → "200%"', () => {
    expect(formatHud({ x: 0, y: 0, zoom: 2 }, cursor, 0, 0, 0).zoom).toBe('200%');
  });

  it('zoom 0.05 → "5%"', () => {
    expect(formatHud({ x: 0, y: 0, zoom: 0.05 }, cursor, 0, 0, 0).zoom).toBe('5%');
  });

  it('zoom 8 → "800%"', () => {
    expect(formatHud({ x: 0, y: 0, zoom: 8 }, cursor, 0, 0, 0).zoom).toBe('800%');
  });
});

describe('formatHud — -0 normalization (brief R4)', () => {
  it('cam at origin: "0.0, 0.0" (not "-0.0, -0.0")', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    expect(formatHud(cam, null, 0, 0, 0).cam).toBe('0.0, 0.0');
  });

  it('world near origin with small negative: "0.0" not "-0.0"', () => {
    // cam at origin, cursor at (-0.04, 0): world = -0.04, 0 → "0.0, 0.0"
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const hud = formatHud(cam, { x: -0.04, y: 0 }, 0, 0, 0);
    expect(hud.world).toBe('0.0, 0.0');
  });

  it('screen near origin: "0, 0" not "-0, -0"', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const hud = formatHud(cam, { x: -0.3, y: -0.3 }, 0, 0, 0);
    // Math.round(-0.3) = -0, normalized to "0"
    expect(hud.screen).toBe('0, 0');
  });

  it('real negative values are preserved (not normalized)', () => {
    const cam: Camera = { x: -640, y: -360, zoom: 1 };
    const hud = formatHud(cam, { x: 300, y: 200 }, 0, 0, 0);
    expect(hud.cam).toBe('-640.0, -360.0');
    expect(hud.world).toBe('-340.0, -160.0');
  });
});

describe('formatHud — screen rounding', () => {
  const cam: Camera = { x: 0, y: 0, zoom: 1 };

  it('rounds to nearest integer', () => {
    expect(formatHud(cam, { x: 300.7, y: 200.3 }, 0, 0, 0).screen).toBe('301, 200');
  });

  it('integer cursor is exact', () => {
    expect(formatHud(cam, { x: 652, y: 390 }, 0, 0, 0).screen).toBe('652, 390');
  });
});

// T-007 R9 — the nodes string (fifth HUD line).
describe('formatHud — nodes counter (T-007 R9)', () => {
  const cam: Camera = { x: -640, y: -360, zoom: 1 };

  it('node count 0 → "0"', () => {
    expect(formatHud(cam, null, 0, 0, 0).nodes).toBe('0');
  });

  it('node counts 1 and 2 → "1" and "2"', () => {
    expect(formatHud(cam, null, 1, 0, 0).nodes).toBe('1');
    expect(formatHud(cam, { x: 300, y: 200 }, 2, 0, 0).nodes).toBe('2');
  });

  it('a larger count is a plain integer', () => {
    expect(formatHud(cam, null, 1234, 0, 0).nodes).toBe('1234');
  });

  it('nodes is shown with or without a cursor', () => {
    expect(formatHud(cam, null, 7, 0, 0).nodes).toBe('7');
    expect(formatHud(cam, { x: 10, y: 20 }, 7, 0, 0).nodes).toBe('7');
  });

  it('a fractional count is rounded (defensive)', () => {
    expect(formatHud(cam, null, 2.4, 0, 0).nodes).toBe('2');
    expect(formatHud(cam, null, 2.6, 0, 0).nodes).toBe('3');
  });
});

// T-008 R7 / R9 — the selected and rev strings (sixth and seventh HUD lines).
describe('formatHud — selected and rev counters (T-008 R9)', () => {
  const cam: Camera = { x: -640, y: -360, zoom: 1 };

  it('selected 0 and rev 0 → "0" and "0"', () => {
    const hud = formatHud(cam, null, 0, 0, 0);
    expect(hud.selected).toBe('0');
    expect(hud.rev).toBe('0');
  });

  it('selected 1 with rev 1 (a fresh card) → "1" and "1"', () => {
    const hud = formatHud(cam, { x: 300, y: 200 }, 1, 1, 1);
    expect(hud.selected).toBe('1');
    expect(hud.rev).toBe('1');
  });

  it('selected and rev are independent of each other and of nodes', () => {
    const hud = formatHud(cam, null, 5, 2, 9);
    expect(hud.nodes).toBe('5');
    expect(hud.selected).toBe('2');
    expect(hud.rev).toBe('9');
  });

  it('larger values are plain integers', () => {
    const hud = formatHud(cam, null, 12, 11, 3456);
    expect(hud.selected).toBe('11');
    expect(hud.rev).toBe('3456');
  });

  it('selected and rev are shown with or without a cursor', () => {
    expect(formatHud(cam, null, 1, 1, 2).selected).toBe('1');
    expect(formatHud(cam, { x: 10, y: 20 }, 1, 1, 2).selected).toBe('1');
    expect(formatHud(cam, null, 1, 1, 2).rev).toBe('2');
    expect(formatHud(cam, { x: 10, y: 20 }, 1, 1, 2).rev).toBe('2');
  });

  it('fractional values are rounded (defensive)', () => {
    expect(formatHud(cam, null, 0, 2.4, 3.6).selected).toBe('2');
    expect(formatHud(cam, null, 0, 2.4, 3.6).rev).toBe('4');
  });
});
