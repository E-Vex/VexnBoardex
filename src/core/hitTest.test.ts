import { describe, expect, it } from 'vitest';

import type { Doc, Node } from './types';
import { hitTest, hitTestWithHandles, hitTestResizeHandles } from './hitTest';
import type { Point } from './geometry';

function node(id: string, overrides: Partial<Node> = {}): Node {
  return {
    id,
    kind: 'card',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    text: '',
    color: '#fff',
    tags: [],
    ...overrides,
  };
}

/** A doc whose `order` lists the given nodes bottom → top. */
function docOf(...nodes: Node[]): Doc {
  const doc: Doc = { nodes: {}, edges: {}, groups: {}, order: [] };
  for (const n of nodes) {
    doc.nodes[n.id] = n;
    doc.order.push(n.id);
  }
  return doc;
}

describe('hitTest — top-most wins (R1)', () => {
  it('returns the later node in order when two overlap', () => {
    // a spans (0,0)–(100,50); b spans (50,0)–(150,50); overlap x 50–100.
    const a = node('a', { x: 0, y: 0 });
    const b = node('b', { x: 50, y: 0 });
    const doc = docOf(a, b); // order: [a, b] — b is on top

    // A point in the overlap hits b (later in order).
    expect(hitTest(doc, { x: 75, y: 25 })).toBe('b');
    // A point only inside a still hits a.
    expect(hitTest(doc, { x: 25, y: 25 })).toBe('a');
    // A point only inside b hits b.
    expect(hitTest(doc, { x: 125, y: 25 })).toBe('b');
  });

  it('swapping the order swaps the winner', () => {
    const a = node('a', { x: 0, y: 0 });
    const b = node('b', { x: 50, y: 0 });
    const doc = docOf(b, a); // order: [b, a] — a is on top now

    expect(hitTest(doc, { x: 75, y: 25 })).toBe('a');
  });

  it('a node later in order but not under the point never wins', () => {
    const a = node('a', { x: 0, y: 0 });
    const b = node('b', { x: 1000, y: 1000 }); // top of the order, far away
    const doc = docOf(a, b);

    expect(hitTest(doc, { x: 10, y: 10 })).toBe('a');
  });
});

describe('hitTest — boundary inclusion (R1)', () => {
  const doc = docOf(node('n', { x: 10, y: 20, w: 100, h: 50 }));

  it('the left and top edges count as inside', () => {
    expect(hitTest(doc, { x: 10, y: 20 })).toBe('n');
    expect(hitTest(doc, { x: 50, y: 20 })).toBe('n');
    expect(hitTest(doc, { x: 10, y: 45 })).toBe('n');
  });

  it('the right and bottom edges count as inside', () => {
    expect(hitTest(doc, { x: 110, y: 70 })).toBe('n');
    expect(hitTest(doc, { x: 110, y: 45 })).toBe('n');
    expect(hitTest(doc, { x: 50, y: 70 })).toBe('n');
  });

  it('points just outside every edge miss', () => {
    expect(hitTest(doc, { x: 9.999, y: 45 })).toBeNull();
    expect(hitTest(doc, { x: 110.001, y: 45 })).toBeNull();
    expect(hitTest(doc, { x: 50, y: 19.999 })).toBeNull();
    expect(hitTest(doc, { x: 50, y: 70.001 })).toBeNull();
  });
});

describe('hitTest — misses (R1)', () => {
  it('an empty document returns null', () => {
    const doc: Doc = { nodes: {}, edges: {}, groups: {}, order: [] };
    expect(hitTest(doc, { x: 0, y: 0 })).toBeNull();
  });

  it('a point outside all nodes returns null', () => {
    const doc = docOf(
      node('a', { x: 0, y: 0 }),
      node('b', { x: 200, y: 200 }),
    );
    expect(hitTest(doc, { x: 150, y: 100 })).toBeNull();
    expect(hitTest(doc, { x: -1, y: -1 })).toBeNull();
  });
});

describe('hitTestWithHandles — selection scope (T-018)', () => {
  const cam = { x: -640, y: -360, zoom: 1 };

  /** A doc with two disjoint nodes: a at (0,0) 200×80, b at (400,0) 200×80. */
  function doc2(): Doc {
    return docOf(
      node('a', { x: 0, y: 0, w: 200, h: 80 }),
      node('b', { x: 400, y: 0, w: 200, h: 80 }),
    );
  }

  it('a handle of a selected node is hit', () => {
    const d = doc2();
    // a's right handle sits at world (200, 40).
    const hit = hitTestWithHandles(d, { x: 200, y: 40 }, cam, ['a']);
    expect(hit).toEqual({ type: 'handle', id: 'a', anchor: 'right' });
  });

  it('a handle of an UNSELECTED node is not hit — the body is', () => {
    const d = doc2();
    const hit = hitTestWithHandles(d, { x: 200, y: 40 }, cam, []);
    expect(hit).toEqual({ type: 'node', id: 'a' });
  });

  it('handles of a selected node win over another selected node\'s body', () => {
    const d = doc2();
    // b's left handle sits at world (400, 40); with both selected, the
    // top-most (b) is scanned first and its handle wins.
    const hit = hitTestWithHandles(d, { x: 400, y: 40 }, cam, ['a', 'b']);
    expect(hit).toEqual({ type: 'handle', id: 'b', anchor: 'left' });
  });

  it('with no selection at all, handles are not hit anywhere', () => {
    const d = doc2();
    for (const [id, n] of Object.entries(d.nodes)) {
      for (const anchor of ['top', 'right', 'bottom', 'left'] as const) {
        const p = handlePoint(n, anchor);
        expect(hitTestWithHandles(d, p, cam, [])).toEqual({ type: 'node', id });
      }
    }
  });
});

/** The world point of a node handle (mirrors the renderer's geometry). */
function handlePoint(
  n: { x: number; y: number; w: number; h: number },
  anchor: 'top' | 'right' | 'bottom' | 'left',
): Point {
  switch (anchor) {
    case 'top':
      return { x: n.x + n.w / 2, y: n.y };
    case 'right':
      return { x: n.x + n.w, y: n.y + n.h / 2 };
    case 'bottom':
      return { x: n.x + n.w / 2, y: n.y + n.h };
    case 'left':
      return { x: n.x, y: n.y + n.h / 2 };
  }
}

describe('hitTestResizeHandles — corner hit-testing (T-021)', () => {
  const cam = { x: -640, y: -360, zoom: 1 };

  /** A single node a at (0,0) 200×80: corners (0,0),(200,0),(0,80),(200,80). */
  function doc1(): Doc {
    return docOf(node('a', { x: 0, y: 0, w: 200, h: 80 }));
  }

  it('each corner of the single selected node is hit', () => {
    const d = doc1();
    expect(hitTestResizeHandles(d, { x: 0, y: 0 }, cam, ['a'])).toEqual({
      type: 'resize', id: 'a', corner: 'nw',
    });
    expect(hitTestResizeHandles(d, { x: 200, y: 0 }, cam, ['a'])).toEqual({
      type: 'resize', id: 'a', corner: 'ne',
    });
    expect(hitTestResizeHandles(d, { x: 0, y: 80 }, cam, ['a'])).toEqual({
      type: 'resize', id: 'a', corner: 'sw',
    });
    expect(hitTestResizeHandles(d, { x: 200, y: 80 }, cam, ['a'])).toEqual({
      type: 'resize', id: 'a', corner: 'se',
    });
  });

  it('no hit without a single selection', () => {
    const d = doc1();
    expect(hitTestResizeHandles(d, { x: 0, y: 0 }, cam, [])).toBeNull();
    const d2 = docOf(
      node('a', { x: 0, y: 0, w: 200, h: 80 }),
      node('b', { x: 400, y: 0, w: 200, h: 80 }),
    );
    expect(hitTestResizeHandles(d2, { x: 0, y: 0 }, cam, ['a', 'b'])).toBeNull();
  });

  it('a point inside the body but away from corners is not a resize hit', () => {
    const d = doc1();
    expect(hitTestResizeHandles(d, { x: 100, y: 40 }, cam, ['a'])).toBeNull();
  });
});
