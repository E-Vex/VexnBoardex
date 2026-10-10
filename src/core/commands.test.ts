import { describe, expect, it } from 'vitest';

import type { Command, Doc, Node } from './types';
import { emptyDoc } from './doc';
import { deepEqual } from './deepEqual';
import { applyPatch } from './patch';
import { CommandError, compileCommand } from './commands';

function node(id: string, overrides: Partial<Node> = {}): Node {
  return {
    id,
    kind: 'text',
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

function docWith(...nodes: Node[]): Doc {
  const d = emptyDoc();
  for (const n of nodes) {
    d.nodes[n.id] = n;
    d.order.push(n.id);
  }
  return d;
}

describe('node.create — appends on top', () => {
  it('adds the node and appends its id to order', () => {
    const doc = docWith(node('n1'));
    const n2 = node('n2', { x: 200 });
    const patch = compileCommand(doc, { type: 'node.create', node: n2 });
    expect(patch.nodes.n2).toEqual({ after: n2 });
    expect(patch.order).toEqual({ before: ['n1'], after: ['n1', 'n2'] });
    const next = applyPatch(doc, patch);
    expect(next.order).toEqual(['n1', 'n2']);
    expect(next.nodes.n2).toEqual(n2);
  });
});

describe('node.create — rejects each invalid field', () => {
  it('empty id', () => {
    expect(() =>
      compileCommand(docWith(), { type: 'node.create', node: node('') }),
    ).toThrow(CommandError);
  });

  it('id already exists', () => {
    expect(() =>
      compileCommand(docWith(node('n1')), {
        type: 'node.create',
        node: node('n1'),
      }),
    ).toThrow(CommandError);
  });

  it('invalid kind', () => {
    expect(() =>
      compileCommand(docWith(), {
        type: 'node.create',
        node: node('n1', { kind: 'invalid' as Node['kind'] }),
      }),
    ).toThrow(CommandError);
  });

  it('non-finite x', () => {
    expect(() =>
      compileCommand(docWith(), {
        type: 'node.create',
        node: node('n1', { x: NaN }),
      }),
    ).toThrow(CommandError);
  });

  it('non-finite y', () => {
    expect(() =>
      compileCommand(docWith(), {
        type: 'node.create',
        node: node('n1', { y: Infinity }),
      }),
    ).toThrow(CommandError);
  });

  it('w ≤ 0', () => {
    expect(() =>
      compileCommand(docWith(), {
        type: 'node.create',
        node: node('n1', { w: 0 }),
      }),
    ).toThrow(CommandError);
  });

  it('h ≤ 0', () => {
    expect(() =>
      compileCommand(docWith(), {
        type: 'node.create',
        node: node('n1', { h: -5 }),
      }),
    ).toThrow(CommandError);
  });

  it('text is not a string', () => {
    expect(() =>
      compileCommand(docWith(), {
        type: 'node.create',
        node: { ...node('n1'), text: 123 as unknown as string },
      }),
    ).toThrow(CommandError);
  });

  it('color is not a string', () => {
    expect(() =>
      compileCommand(docWith(), {
        type: 'node.create',
        node: { ...node('n1'), color: null as unknown as string },
      }),
    ).toThrow(CommandError);
  });

  it('tags is not an array of strings', () => {
    expect(() =>
      compileCommand(docWith(), {
        type: 'node.create',
        node: { ...node('n1'), tags: ['a', 5] as unknown as string[] },
      }),
    ).toThrow(CommandError);
  });

  it('groupId references a missing group', () => {
    expect(() =>
      compileCommand(docWith(), {
        type: 'node.create',
        node: { ...node('n1'), groupId: 'missing' },
      }),
    ).toThrow(CommandError);
  });

  it('groupId referencing an existing group is accepted', () => {
    const doc = docWith();
    doc.groups = { g1: { id: 'g1', name: 'g' } };
    const n = { ...node('n1'), groupId: 'g1' };
    expect(() => compileCommand(doc, { type: 'node.create', node: n })).not.toThrow();
  });
});

describe('node.move — applies delta to every id', () => {
  it('moves each node by (dx, dy)', () => {
    const doc = docWith(node('n1', { x: 10, y: 20 }), node('n2', { x: 30, y: 40 }));
    const patch = compileCommand(doc, {
      type: 'node.move',
      ids: ['n1', 'n2'],
      dx: 5,
      dy: -3,
    });
    const next = applyPatch(doc, patch);
    expect(next.nodes.n1).toEqual(node('n1', { x: 15, y: 17 }));
    expect(next.nodes.n2).toEqual(node('n2', { x: 35, y: 37 }));
  });

  it('original node is the before', () => {
    const doc = docWith(node('n1', { x: 10, y: 20 }));
    const patch = compileCommand(doc, {
      type: 'node.move',
      ids: ['n1'],
      dx: 5,
      dy: 5,
    });
    expect(patch.nodes.n1!.before).toEqual(node('n1', { x: 10, y: 20 }));
  });

  it('order is untouched', () => {
    const doc = docWith(node('n1'), node('n2'));
    const patch = compileCommand(doc, {
      type: 'node.move',
      ids: ['n1'],
      dx: 5,
      dy: 0,
    });
    expect(patch.order).toBeUndefined();
  });
});

describe('node.move — duplicates ignored', () => {
  it('first occurrence wins', () => {
    const doc = docWith(node('n1', { x: 0, y: 0 }));
    const patch = compileCommand(doc, {
      type: 'node.move',
      ids: ['n1', 'n1'],
      dx: 5,
      dy: 5,
    });
    expect(Object.keys(patch.nodes)).toEqual(['n1']);
  });
});

describe('node.move — rejects non-finite deltas', () => {
  it('NaN dx', () => {
    expect(() =>
      compileCommand(docWith(node('n1')), {
        type: 'node.move',
        ids: ['n1'],
        dx: NaN,
        dy: 0,
      }),
    ).toThrow(CommandError);
  });

  it('Infinity dy', () => {
    expect(() =>
      compileCommand(docWith(node('n1')), {
        type: 'node.move',
        ids: ['n1'],
        dx: 0,
        dy: Infinity,
      }),
    ).toThrow(CommandError);
  });
});

describe('node.move — rejects unknown ids', () => {
  it('unknown id throws even if dx and dy are 0', () => {
    expect(() =>
      compileCommand(docWith(node('n1')), {
        type: 'node.move',
        ids: ['nope'],
        dx: 0,
        dy: 0,
      }),
    ).toThrow(CommandError);
  });
});

describe('node.move — empty patch for no-op cases', () => {
  it('empty ids returns an empty patch', () => {
    const patch = compileCommand(docWith(node('n1')), {
      type: 'node.move',
      ids: [],
      dx: 5,
      dy: 5,
    });
    expect(patch.nodes).toEqual({});
    expect(patch.order).toBeUndefined();
  });

  it('dx === 0 && dy === 0 returns an empty patch', () => {
    const patch = compileCommand(docWith(node('n1')), {
      type: 'node.move',
      ids: ['n1'],
      dx: 0,
      dy: 0,
    });
    expect(patch.nodes).toEqual({});
  });
});

describe('node.delete — removes nodes, order entries and incident edges', () => {
  it('deletes a node and filters order', () => {
    const doc = docWith(node('n1'), node('n2'));
    const patch = compileCommand(doc, { type: 'node.delete', ids: ['n1'] });
    expect(patch.nodes.n1).toEqual({ before: node('n1') });
    expect(patch.order).toEqual({ before: ['n1', 'n2'], after: ['n2'] });
  });

  it('deletes incident edges in the same patch (I-09)', () => {
    const doc = docWith(node('n1'), node('n2'), node('n3'));
    doc.edges = {
      e1: { id: 'e1', from: { node: 'n1', anchor: 'auto' }, to: { node: 'n2', anchor: 'auto' } },
      e2: { id: 'e2', from: { node: 'n2', anchor: 'auto' }, to: { node: 'n3', anchor: 'auto' } },
    };
    const patch = compileCommand(doc, { type: 'node.delete', ids: ['n1'] });
    expect(patch.edges.e1).toBeDefined();
    expect(patch.edges.e1!.before).toEqual(doc.edges.e1);
    // e2 does not touch n1, so it's not in the patch.
    expect(patch.edges.e2).toBeUndefined();
  });

  it('a shared edge (both ends deleted) is listed once', () => {
    const doc = docWith(node('n1'), node('n2'));
    doc.edges = {
      e1: { id: 'e1', from: { node: 'n1', anchor: 'auto' }, to: { node: 'n2', anchor: 'auto' } },
    };
    const patch = compileCommand(doc, {
      type: 'node.delete',
      ids: ['n1', 'n2'],
    });
    expect(Object.keys(patch.edges)).toEqual(['e1']);
  });

  it('before values are correct', () => {
    const n = node('n1', { x: 42 });
    const doc = docWith(n);
    const patch = compileCommand(doc, { type: 'node.delete', ids: ['n1'] });
    expect(patch.nodes.n1!.before).toEqual(n);
  });

  it('nodes in groups are unaffected (only edges touching deleted nodes)', () => {
    const doc = docWith(node('n1'), node('n2'));
    doc.groups = { g1: { id: 'g1', name: 'g' } };
    doc.nodes.n1!.groupId = 'g1';
    const patch = compileCommand(doc, { type: 'node.delete', ids: ['n1'] });
    // Group is not touched.
    expect(patch.groups).toEqual({});
  });
});

describe('node.delete — duplicates ignored', () => {
  it('first occurrence wins', () => {
    const doc = docWith(node('n1'), node('n2'));
    const patch = compileCommand(doc, {
      type: 'node.delete',
      ids: ['n1', 'n1'],
    });
    expect(Object.keys(patch.nodes)).toEqual(['n1']);
  });
});

describe('node.delete — rejects unknown ids', () => {
  it('unknown id throws', () => {
    expect(() =>
      compileCommand(docWith(node('n1')), { type: 'node.delete', ids: ['nope'] }),
    ).toThrow(CommandError);
  });
});

describe('node.delete — empty patch for empty ids', () => {
  it('empty ids returns an empty patch', () => {
    const patch = compileCommand(docWith(node('n1')), {
      type: 'node.delete',
      ids: [],
    });
    expect(patch.nodes).toEqual({});
    expect(patch.order).toBeUndefined();
  });
});

describe('unknown command type throws', () => {
  it('throws CommandError', () => {
    expect(() =>
      compileCommand(docWith(), { type: 'unknown' } as unknown as Command),
    ).toThrow(CommandError);
  });
});

describe('compileCommand — never mutates the doc', () => {
  it('the document is unchanged after compiling', () => {
    const doc = docWith(node('n1', { x: 10 }));
    const before = JSON.parse(JSON.stringify(doc));
    compileCommand(doc, {
      type: 'node.move',
      ids: ['n1'],
      dx: 5,
      dy: 5,
    });
    expect(deepEqual(JSON.parse(JSON.stringify(doc)), before)).toBe(true);
  });
});
