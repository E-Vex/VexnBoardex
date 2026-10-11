import { describe, expect, it } from 'vitest';

import { emptyDoc } from '../core/doc';
import type { Doc, Node, NodeKind } from '../core/types';
import { cameraCenteredOn, visibleWorldRect, type Camera } from './camera';
import { dotCount, dotIndexRange, gridStep } from './grid';
import { renderBoard } from './renderer';

/**
 * A recording stub for `CanvasRenderingContext2D`. Every method call and
 * property set is appended to `calls` as `{ name, args }`. The renderer
 * never reads properties back, so getters return harmless defaults —
 * except `measureText`, which returns a deterministic width (10 units per
 * character) so text layout can be exercised without a real canvas
 * (T-007 R12).
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
      if (prop === 'measureText') {
        return (s: string): { width: number } => {
          calls.push({ name: 'measureText', args: [s] });
          return { width: s.length * 10 };
        };
      }
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

/** Index of the first recorded call with the given name (-1 when absent). */
function firstIndex(ctx: { calls: RecordedCall[] }, name: string): number {
  return ctx.calls.findIndex((c) => c.name === name);
}

/** Index of the last recorded call with the given name (-1 when absent). */
function lastIndex(ctx: { calls: RecordedCall[] }, name: string): number {
  let idx = -1;
  for (let i = 0; i < ctx.calls.length; i++) {
    if (ctx.calls[i]!.name === name) idx = i;
  }
  return idx;
}

/** Build a node with a valid shape (positions/sizes from the caller). */
function makeNode(id: string, overrides: Partial<Node> = {}): Node {
  return {
    id,
    kind: 'card' as NodeKind,
    x: 0,
    y: 0,
    w: 200,
    h: 120,
    text: `text of ${id}`,
    color: '#ffffff',
    tags: [],
    ...overrides,
  };
}

/** A doc whose `order` lists the given nodes bottom → top. */
function docOf(...nodes: Node[]): Doc {
  const doc = emptyDoc();
  for (const n of nodes) {
    doc.nodes[n.id] = n;
    doc.order.push(n.id);
  }
  return doc;
}

describe('renderBoard — grid drawing', () => {
  it('at least one draw call at the default zoom (zoom 1, 1280×720)', () => {
    const cam = cameraCenteredOn({ x: 0, y: 0 }, 1280, 720, 1);
    const ctx = createStubCtx();
    renderBoard(ctx, { width: 1280, height: 720 }, cam, emptyDoc());

    // Background is always drawn.
    expect(countCalls(ctx, 'fillRect')).toBe(1);
    // Grid dots: at least one rect in the path and one fill.
    expect(countCalls(ctx, 'rect')).toBeGreaterThan(0);
    expect(countCalls(ctx, 'fill')).toBeGreaterThanOrEqual(1);
  });

  it('draws the origin cross marker when (0, 0) is visible', () => {
    const cam = cameraCenteredOn({ x: 0, y: 0 }, 1280, 720, 1);
    const ctx = createStubCtx();
    renderBoard(ctx, { width: 1280, height: 720 }, cam, emptyDoc());

    // Origin marker: one stroke with 4 line ops (2 moveTo + 2 lineTo).
    expect(countCalls(ctx, 'stroke')).toBe(1);
    expect(countCalls(ctx, 'moveTo')).toBe(2);
    expect(countCalls(ctx, 'lineTo')).toBe(2);
  });

  it('does not draw the origin cross marker when (0, 0) is off-screen', () => {
    // Camera far from origin — world (0,0) is not in the visible rect.
    const cam: Camera = { x: 5000, y: 5000, zoom: 1 };
    const ctx = createStubCtx();
    renderBoard(ctx, { width: 1280, height: 720 }, cam, emptyDoc());

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
    const visible = visibleWorldRect(cam, width, height);
    const step = gridStep(1);
    const range = dotIndexRange(visible, step);
    const count = dotCount(range);

    // Sanity: the scenario actually exceeds the cap.
    expect(count).toBeGreaterThan(50_000);

    const ctx = createStubCtx();
    renderBoard(ctx, { width, height }, cam, emptyDoc());

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
    const visible = visibleWorldRect(cam, width, height);
    const step = gridStep(0.05);
    const range = dotIndexRange(visible, step);
    const count = dotCount(range);

    // At this zoom/viewport the cap is NOT exceeded.
    expect(count).toBeLessThanOrEqual(50_000);

    const ctx = createStubCtx();
    renderBoard(ctx, { width, height }, cam, emptyDoc());

    // Grid is drawn: rect calls present, fill call present.
    expect(countCalls(ctx, 'rect')).toBeGreaterThan(0);
    expect(countCalls(ctx, 'fill')).toBeGreaterThanOrEqual(1);
  });
});

describe('renderBoard — background always drawn', () => {
  it('fills the background even when the grid is capped', () => {
    const cam = cameraCenteredOn({ x: 0, y: 0 }, 20_000, 20_000, 1);
    const ctx = createStubCtx();
    renderBoard(ctx, { width: 20_000, height: 20_000 }, cam, emptyDoc());

    const fillRectCalls = ctx.calls.filter((c) => c.name === 'fillRect');
    expect(fillRectCalls).toHaveLength(1);
    // fillRect(0, 0, width, height) for the background.
    expect(fillRectCalls[0]!.args).toEqual([0, 0, 20_000, 20_000]);
  });
});

// T-007 R12 — node drawing: order, culling, text LOD, empty doc.
describe('renderBoard — node drawing order (T-007 R12)', () => {
  const cam = cameraCenteredOn({ x: 0, y: 0 }, 1280, 720, 1);

  it('nodes are drawn after the grid, in doc.order order (bottom → top)', () => {
    const a = makeNode('a', { x: -300, y: -100 });
    const b = makeNode('b', { x: 100, y: -100 });
    const ctx = createStubCtx();
    renderBoard(ctx, { width: 1280, height: 720 }, cam, docOf(a, b));

    // Both nodes drawn: two rounded-rect paths (4 arcTo each).
    expect(countCalls(ctx, 'arcTo')).toBe(8);
    // Every grid 'rect' call happens before the first node 'arcTo'.
    expect(lastIndex(ctx, 'rect')).toBeGreaterThan(-1);
    expect(firstIndex(ctx, 'arcTo')).toBeGreaterThan(lastIndex(ctx, 'rect'));
    // Text of node a is drawn before text of node b (order: a then b).
    const textArgs = ctx.calls
      .filter((c) => c.name === 'fillText')
      .map((c) => c.args[0]);
    expect(textArgs).toEqual(['text of a', 'text of b']);
  });

  it('swapping the order swaps the drawing order', () => {
    const a = makeNode('a', { x: -300, y: -100 });
    const b = makeNode('b', { x: 100, y: -100 });
    const ctx = createStubCtx();
    renderBoard(ctx, { width: 1280, height: 720 }, cam, docOf(b, a));

    const textArgs = ctx.calls
      .filter((c) => c.name === 'fillText')
      .map((c) => c.args[0]);
    expect(textArgs).toEqual(['text of b', 'text of a']);
  });
});

describe('renderBoard — culling (T-007 R12)', () => {
  it('an off-screen node is not drawn', () => {
    const cam = cameraCenteredOn({ x: 0, y: 0 }, 1280, 720, 1);
    // Visible world rect is [-640, 640] × [-360, 360].
    const off = makeNode('off', { x: 5000, y: 5000 });
    const on = makeNode('on', { x: -100, y: -60 });
    const ctx = createStubCtx();
    renderBoard(ctx, { width: 1280, height: 720 }, cam, docOf(off, on));

    // Only the visible node got a path (4 arcTo) and text.
    expect(countCalls(ctx, 'arcTo')).toBe(4);
    const textArgs = ctx.calls
      .filter((c) => c.name === 'fillText')
      .map((c) => c.args[0]);
    expect(textArgs).toEqual(['text of on']);
  });

  it('a node that only edge-touches the visible rect is still drawn', () => {
    // Visible rect right edge is world x = 640; this node's left edge is 640.
    const cam = cameraCenteredOn({ x: 0, y: 0 }, 1280, 720, 1);
    const touching = makeNode('touch', { x: 640, y: -60 });
    const ctx = createStubCtx();
    renderBoard(ctx, { width: 1280, height: 720 }, cam, docOf(touching));

    expect(countCalls(ctx, 'arcTo')).toBe(4);
    expect(countCalls(ctx, 'fillText')).toBe(1);
  });
});

describe('renderBoard — text LOD (T-007 R12)', () => {
  it('no text is drawn when fontSize × zoom is below the minimum', () => {
    // FONT_SIZE 16 × zoom 0.2 = 3.2 < MIN_TEXT_SIZE 4 → skip text.
    // The node is still visible at this zoom (culling is about rects).
    const cam = cameraCenteredOn({ x: 0, y: 0 }, 1280, 720, 0.2);
    const node = makeNode('n', { x: -100, y: -60 });
    const ctx = createStubCtx();
    renderBoard(ctx, { width: 1280, height: 720 }, cam, docOf(node));

    // The node box is drawn…
    expect(countCalls(ctx, 'arcTo')).toBe(4);
    expect(countCalls(ctx, 'fill')).toBeGreaterThanOrEqual(1);
    // …but no text and no measuring happened.
    expect(countCalls(ctx, 'fillText')).toBe(0);
    expect(countCalls(ctx, 'measureText')).toBe(0);
  });

  it('text is drawn at zoom 1', () => {
    const cam = cameraCenteredOn({ x: 0, y: 0 }, 1280, 720, 1);
    const node = makeNode('n', { x: -100, y: -60 });
    const ctx = createStubCtx();
    renderBoard(ctx, { width: 1280, height: 720 }, cam, docOf(node));

    expect(countCalls(ctx, 'fillText')).toBe(1);
    expect(ctx.calls.find((c) => c.name === 'fillText')!.args[0]).toBe(
      'text of n',
    );
  });

  it('at the exact boundary (fontSize × zoom = minimum) text is drawn', () => {
    // 16 × 0.25 = 4 = MIN_TEXT_SIZE → not below the minimum → drawn.
    const cam = cameraCenteredOn({ x: 0, y: 0 }, 1280, 720, 0.25);
    const node = makeNode('n', { x: -400, y: -240 });
    const ctx = createStubCtx();
    renderBoard(ctx, { width: 1280, height: 720 }, cam, docOf(node));

    expect(countCalls(ctx, 'fillText')).toBe(1);
  });
});

describe('renderBoard — empty document (T-007 R12)', () => {
  it('an empty document draws no node paths', () => {
    // Camera far from the origin so the origin marker does not draw either.
    const cam: Camera = { x: 5000, y: 5000, zoom: 1 };
    const ctx = createStubCtx();
    renderBoard(ctx, { width: 1280, height: 720 }, cam, emptyDoc());

    expect(countCalls(ctx, 'arcTo')).toBe(0);
    expect(countCalls(ctx, 'fillText')).toBe(0);
    expect(countCalls(ctx, 'measureText')).toBe(0);
    expect(countCalls(ctx, 'stroke')).toBe(0);
    // Background + grid are still drawn exactly once.
    expect(countCalls(ctx, 'fillRect')).toBe(1);
    expect(countCalls(ctx, 'fill')).toBe(1);
  });
});
