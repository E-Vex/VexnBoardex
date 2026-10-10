import { describe, expect, it } from 'vitest';

import type { Doc, Node, Edge, Group } from './types';
import { emptyDoc, validateDoc } from './doc';

function node(id: string, overrides: Partial<Node> = {}): Node {
  return {
    id,
    kind: 'text',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    text: '',
    color: '#ffffff',
    tags: [],
    ...overrides,
  };
}

function edge(
  id: string,
  from: string,
  to: string,
  overrides: Partial<Edge> = {},
): Edge {
  return {
    id,
    from: { node: from, anchor: 'auto' },
    to: { node: to, anchor: 'auto' },
    ...overrides,
  };
}

function group(id: string, name = 'g'): Group {
  return { id, name };
}

function validDoc(): Doc {
  const n1 = node('n1');
  const n2 = node('n2', { x: 200, y: 100 });
  return {
    nodes: { n1, n2 },
    edges: { e1: edge('e1', 'n1', 'n2') },
    groups: {},
    order: ['n1', 'n2'],
  };
}

describe('validateDoc — valid docs', () => {
  it('empty doc is valid', () => {
    expect(validateDoc(emptyDoc())).toEqual([]);
  });

  it('a valid sample doc is valid', () => {
    expect(validateDoc(validDoc())).toEqual([]);
  });

  it('a doc with groups and groupIds is valid', () => {
    const doc = validDoc();
    doc.groups = { g1: group('g1') };
    doc.nodes.n1!.groupId = 'g1';
    expect(validateDoc(doc)).toEqual([]);
  });
});

describe('validateDoc — order-mismatch', () => {
  it('order missing a node id', () => {
    const doc = validDoc();
    doc.order = ['n1'];
    const errs = validateDoc(doc);
    expect(errs.some((e) => e.startsWith('order-mismatch:'))).toBe(true);
  });

  it('order has an extra id', () => {
    const doc = validDoc();
    doc.order = ['n1', 'n2', 'n3'];
    const errs = validateDoc(doc);
    expect(errs.some((e) => e.startsWith('order-mismatch:'))).toBe(true);
  });

  it('order has duplicates', () => {
    const doc = validDoc();
    doc.order = ['n1', 'n1'];
    const errs = validateDoc(doc);
    expect(errs.some((e) => e.startsWith('order-mismatch:'))).toBe(true);
  });
});

describe('validateDoc — key-mismatch', () => {
  it('node key differs from node.id', () => {
    const doc = validDoc();
    doc.nodes.n1!.id = 'wrong';
    const errs = validateDoc(doc);
    expect(errs.some((e) => e.startsWith('key-mismatch:'))).toBe(true);
  });

  it('edge key differs from edge.id', () => {
    const doc = validDoc();
    doc.edges.e1!.id = 'wrong';
    const errs = validateDoc(doc);
    expect(errs.some((e) => e.startsWith('key-mismatch:'))).toBe(true);
  });

  it('group key differs from group.id', () => {
    const doc = validDoc();
    doc.groups = { wrongKey: group('g1') };
    const errs = validateDoc(doc);
    expect(errs.some((e) => e.startsWith('key-mismatch:'))).toBe(true);
  });
});

describe('validateDoc — edge-dangling', () => {
  it('edge references a missing from.node', () => {
    const doc = validDoc();
    doc.edges.e1!.from.node = 'nope';
    const errs = validateDoc(doc);
    expect(errs.some((e) => e.startsWith('edge-dangling:'))).toBe(true);
  });

  it('edge references a missing to.node', () => {
    const doc = validDoc();
    doc.edges.e1!.to.node = 'nope';
    const errs = validateDoc(doc);
    expect(errs.some((e) => e.startsWith('edge-dangling:'))).toBe(true);
  });
});

describe('validateDoc — edge-self', () => {
  it('edge from.node equals to.node', () => {
    const doc = validDoc();
    doc.edges.e1!.to.node = 'n1';
    const errs = validateDoc(doc);
    expect(errs.some((e) => e.startsWith('edge-self:'))).toBe(true);
  });
});

describe('validateDoc — group-dangling', () => {
  it('node.groupId references a missing group', () => {
    const doc = validDoc();
    doc.nodes.n1!.groupId = 'missing';
    const errs = validateDoc(doc);
    expect(errs.some((e) => e.startsWith('group-dangling:'))).toBe(true);
  });
});

describe('validateDoc — bad-number', () => {
  it('non-finite x', () => {
    const doc = validDoc();
    doc.nodes.n1!.x = NaN;
    const errs = validateDoc(doc);
    expect(errs.some((e) => e.startsWith('bad-number:'))).toBe(true);
  });

  it('non-finite y', () => {
    const doc = validDoc();
    doc.nodes.n1!.y = Infinity;
    const errs = validateDoc(doc);
    expect(errs.some((e) => e.startsWith('bad-number:'))).toBe(true);
  });

  it('w ≤ 0', () => {
    const doc = validDoc();
    doc.nodes.n1!.w = 0;
    const errs = validateDoc(doc);
    expect(errs.some((e) => e.startsWith('bad-number:'))).toBe(true);
  });

  it('h ≤ 0', () => {
    const doc = validDoc();
    doc.nodes.n1!.h = -10;
    const errs = validateDoc(doc);
    expect(errs.some((e) => e.startsWith('bad-number:'))).toBe(true);
  });

  it('non-finite w', () => {
    const doc = validDoc();
    doc.nodes.n1!.w = Infinity;
    const errs = validateDoc(doc);
    expect(errs.some((e) => e.startsWith('bad-number:'))).toBe(true);
  });
});

describe('validateDoc — multiple violations', () => {
  it('reports all violations found', () => {
    const doc = validDoc();
    doc.nodes.n1!.x = NaN; // bad-number
    doc.nodes.n1!.id = 'wrong'; // key-mismatch
    doc.order = ['n1']; // order-mismatch (missing n2)
    const errs = validateDoc(doc);
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });
});
