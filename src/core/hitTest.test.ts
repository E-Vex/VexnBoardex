import { describe, expect, it } from 'vitest';

import type { Doc, Node } from './types';
import { hitTest } from './hitTest';

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
