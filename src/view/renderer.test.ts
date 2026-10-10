import { describe, expect, it } from 'vitest';

import type { Rect } from '../core/geometry';
import { cameraCenteredOn, visibleWorldRect, type Camera } from './camera';
import { dotCount, dotIndexRange, gridStep } from './grid';
import { renderBoard } from './renderer';

/**
 * A recording stub for `CanvasRenderingContext2D`. Every method call and
 * property set is appended to `calls` as `{ name, args }`. The renderer
 * never reads properties back, so getters return harmless defaults.
 */
interface RecordedCall {
  name: string;
  args: unknown[];
}

function createStubCtx(): CanvasRenderingContext2D & {
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(_t, prop: string) {
      if (prop === 'calls') return calls;
      return (...args: unknown[]): void => {
        calls.push({ name: prop, args });
      };
    },
    set(_t, prop: string, value: unknown): boolean {
      calls.push({ name: prop, args: [value] });
      return true;
    },
  });
  return ctx as unknown as CanvasRenderingContext2D & {
    calls: RecordedCall[];
  };
}

function countCalls(ctx: { calls: RecordedCall[] }, name: string): number {
  return ctx.calls.filter((c) => c.name === name).length;
}

describe('renderBoard — grid drawing', () => {
  it('at least one draw call at the default zoom (zoom 1, 1280×720)', () => {
    const cam = cameraCenteredOn({ x: 0, y: 0 }, 1280, 720, 1);
    const ctx = createStubCtx();
    renderBoard(ctx, { width: 1280, height: 720 }, cam);

    // Background is always drawn.
    expect(countCalls(ctx, 'fillRect')).toBe(1);
    // Grid dots: at least one rect in the path and one fill.
    expect(countCalls(ctx, 'rect')).toBeGreaterThan(0);
    expect(countCalls(ctx, 'fill')).toBeGreaterThanOrEqual(1);
  });

  it('draws the origin cross marker when (0, 0) is visible', () => {
    const cam = cameraCenteredOn({ x: 0, y: 0 }, 1280, 720, 1);
    const ctx = createStubCtx();
    renderBoard(ctx, { width: 1280, height: 720 }, cam);

    // Origin marker: one stroke with 4 line ops (2 moveTo + 2 lineTo).
    expect(countCalls(ctx, 'stroke')).toBe(1);
    expect(countCalls(ctx, 'moveTo')).toBe(2);
    expect(countCalls(ctx, 'lineTo')).toBe(2);
  });

  it('does not draw the origin cross marker when (0, 0) is off-screen', () => {
    // Camera far from origin — world (0,0) is not in the visible rect.
    const cam: Camera = { x: 5000, y: 5000, zoom: 1 };
    const ctx = createStubCtx();
    renderBoard(ctx, { width: 1280, height: 720 }, cam);

    expect(countCalls(ctx, 'stroke')).toBe(0);
    expect(countCalls(ctx, 'moveTo')).toBe(0);
    expect(countCalls(ctx, 'lineTo')).toBe(0);
  });
});

describe('renderBoard — safety cap (R3)', () => {
  it('no grid rect/fill calls when dotCount exceeds MAX_DOTS', () => {
    // Use a very large viewport so the dot count exceeds 50 000 at zoom 1.
    const width = 20_000;
    const height = 20_000;
    const cam = cameraCenteredOn({ x: 0, y: 0 }, width, height, 1);
    const visible: Rect = visibleWorldRect(cam, width, height);
    const step = gridStep(1);
    const range = dotIndexRange(visible, step);
    const count = dotCount(range);

    // Sanity: the scenario actually exceeds the cap.
    expect(count).toBeGreaterThan(50_000);

    const ctx = createStubCtx();
    renderBoard(ctx, { width, height }, cam);

    // Background still drawn.
    expect(countCalls(ctx, 'fillRect')).toBe(1);
    // Grid skipped: no rect calls, no fill calls.
    expect(countCalls(ctx, 'rect')).toBe(0);
    expect(countCalls(ctx, 'fill')).toBe(0);
  });

  it('grid IS drawn at zoom 0.05 on a 3840×2160 viewport (dotCount ≤ cap)', () => {
    const width = 3840;
    const height = 2160;
    const cam = cameraCenteredOn({ x: 0, y: 0 }, width, height, 0.05);
    const visible: Rect = visibleWorldRect(cam, width, height);
    const step = gridStep(0.05);
    const range = dotIndexRange(visible, step);
    const count = dotCount(range);

    // At this zoom/viewport the cap is NOT exceeded.
    expect(count).toBeLessThanOrEqual(50_000);

    const ctx = createStubCtx();
    renderBoard(ctx, { width, height }, cam);

    // Grid is drawn: rect calls present, fill call present.
    expect(countCalls(ctx, 'rect')).toBeGreaterThan(0);
    expect(countCalls(ctx, 'fill')).toBeGreaterThanOrEqual(1);
  });
});

describe('renderBoard — background always drawn', () => {
  it('fills the background even when the grid is capped', () => {
    const cam = cameraCenteredOn({ x: 0, y: 0 }, 20_000, 20_000, 1);
    const ctx = createStubCtx();
    renderBoard(ctx, { width: 20_000, height: 20_000 }, cam);

    const fillRectCalls = ctx.calls.filter((c) => c.name === 'fillRect');
    expect(fillRectCalls).toHaveLength(1);
    // fillRect(0, 0, width, height) for the background.
    expect(fillRectCalls[0]!.args).toEqual([0, 0, 20_000, 20_000]);
  });
});
