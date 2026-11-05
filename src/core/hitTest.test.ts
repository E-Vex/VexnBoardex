import { describe, expect, it } from 'vitest';

import type { Doc, Node } from './types';
import {
  edgeAt,
  hitTest,
  hitTestWithHandles,
  hitTestResizeHandles,
  groupFrameRect,
  groupFrameAt,
  GROUP_FRAME_PADDING,
} from './hitTest';
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

// --- T-033: route-aware edge hit-testing ---

describe('edgeAt — click an edge along its drawn route (T-033)', () => {
  /** a (0,0,100,50) — b (200,0,100,50): a straight edge runs (100,25)→(200,25). */
  function docWithStraightEdge(): Doc {
    const doc = docOf(node('a'), node('b', { x: 200, y: 0 }));
    doc.edges['e1'] = {
      id: 'e1',
      from: { node: 'a', anchor: 'auto' },
      to: { node: 'b', anchor: 'auto' },
    };
    return doc;
  }

  it('a point on the straight route hits the edge', () => {
    expect(edgeAt(docWithStraightEdge(), { x: 150, y: 25 }, 1)).toBe('e1');
  });

  it('a point 5 world units off the line hits at zoom 1 (6 screen px)', () => {
    expect(edgeAt(docWithStraightEdge(), { x: 150, y: 30 }, 1)).toBe('e1');
  });

  it('a point 10 world units off the line misses at zoom 1', () => {
    expect(edgeAt(docWithStraightEdge(), { x: 150, y: 35 }, 1)).toBeNull();
  });

  it('the threshold is in SCREEN pixels: zoom 0.5 makes 10 world units a hit', () => {
    // 10 world units at zoom 0.5 = 5 screen px, within EDGE_HIT_RADIUS.
    expect(edgeAt(docWithStraightEdge(), { x: 150, y: 35 }, 0.5)).toBe('e1');
    // 20 world units at zoom 2 = 40 screen px — far out.
    expect(edgeAt(docWithStraightEdge(), { x: 150, y: 45 }, 2)).toBeNull();
  });

  it('an orthogonal edge is hit along its whole elbow, off the straight line', () => {
    // a (0,0,100,50), b (200,100,100,50): auto/auto orthogonal gives the
    // Z (100,25) → (150,25) → (150,125) → (200,125). The probe (150,95) is
    // ON the vertical middle segment but ~18 world units from the straight
    // line — unreachable before T-033.
    const doc = docOf(node('a'), node('b', { x: 200, y: 100 }));
    doc.edges['e1'] = {
      id: 'e1',
      from: { node: 'a', anchor: 'auto' },
      to: { node: 'b', anchor: 'auto' },
      route: 'orthogonal',
    };
    expect(edgeAt(doc, { x: 150, y: 95 }, 1)).toBe('e1');
  });

  it('the NEAREST edge wins when several are within the threshold', () => {
    // e1 a→b along y = 25; e2 a→c runs (75,50)→(225,200). The probe sits
    // exactly on e2 and 100 away from e1.
    const doc = docOf(
      node('a'),
      node('b', { x: 200, y: 0 }),
      node('c', { x: 200, y: 200 }),
    );
    doc.edges['e1'] = {
      id: 'e1',
      from: { node: 'a', anchor: 'auto' },
      to: { node: 'b', anchor: 'auto' },
    };
    doc.edges['e2'] = {
      id: 'e2',
      from: { node: 'a', anchor: 'auto' },
      to: { node: 'c', anchor: 'auto' },
    };
    expect(edgeAt(doc, { x: 150, y: 125 }, 1)).toBe('e2');
  });

  it('a dangling edge (missing node) is skipped, not a hit', () => {
    const doc = docOf(node('a'), node('b', { x: 200, y: 0 }));
    doc.edges['e1'] = {
      id: 'e1',
      from: { node: 'a', anchor: 'auto' },
      to: { node: 'ghost', anchor: 'auto' },
    };
    expect(edgeAt(doc, { x: 150, y: 25 }, 1)).toBeNull();
  });

  it('a doc with no edges never hits', () => {
    expect(edgeAt(docOf(node('a')), { x: 50, y: 25 }, 1)).toBeNull();
  });
});

describe('groupFrameRect — kanban columns (T-035, M9)', () => {
  it("a column's frame IS its stored geometry, memberless or not", () => {
    const doc = docOf();
    doc.groups = {
      c1: { id: 'c1', name: 'To Do', role: 'kanban', x: 10, y: 20, w: 240, h: 400 },
    };
    expect(groupFrameRect(doc, 'c1')).toEqual({ x: 10, y: 20, w: 240, h: 400 });
  });

  it('a column with members still uses the stored rect (not the member bbox)', () => {
    const doc = docOf(node('a', { x: 26, y: 72, w: 200, h: 120 }));
    doc.groups = {
      c1: { id: 'c1', name: 'To Do', role: 'kanban', x: 10, y: 20, w: 240, h: 400 },
    };
    doc.nodes.a!.groupId = 'c1';
    expect(groupFrameRect(doc, 'c1')).toEqual({ x: 10, y: 20, w: 240, h: 400 });
  });

  it('groupFrameAt resolves clicks inside the column rect', () => {
    const doc = docOf();
    doc.groups = {
      c1: { id: 'c1', name: 'To Do', role: 'kanban', x: 10, y: 20, w: 240, h: 400 },
    };
    expect(groupFrameAt(doc, { x: 15, y: 25 })).toBe('c1');
    expect(groupFrameAt(doc, { x: 5, y: 15 })).toBeNull(); // outside
  });

  it('a regular group still derives its rect from members (T-024 unchanged)', () => {
    const doc = docOf(node('a', { x: 0, y: 0, w: 100, h: 50 }));
    doc.groups = { g1: { id: 'g1', name: 'frame' } };
    doc.nodes.a!.groupId = 'g1';
    expect(groupFrameRect(doc, 'g1')).toEqual({
      x: -GROUP_FRAME_PADDING,
      y: -GROUP_FRAME_PADDING,
      w: 100 + GROUP_FRAME_PADDING * 2,
      h: 50 + GROUP_FRAME_PADDING * 2,
    });
    expect(groupFrameRect(doc, 'nope')).toBeNull();
  });
});
