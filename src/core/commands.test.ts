import { describe, expect, it } from 'vitest';

import type { Command, Doc, Edge, EdgeEndpoint, Node } from './types';
import { emptyDoc, validateDoc } from './doc';
import { GROUP_FRAME_PADDING, groupFrameRect, groupMembersOf, groupFrameAt } from './hitTest';
import { deepEqual } from './deepEqual';
import { applyPatch, invertPatch, isEmptyPatch } from './patch';
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

/** Freeze deeply so any mutation throws (T-009 R5). */
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  if (Array.isArray(obj)) {
    for (const el of obj) deepFreeze(el);
  } else {
    for (const v of Object.values(obj as Record<string, unknown>)) {
      deepFreeze(v);
    }
  }
  return obj;
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
    expect(() =>
      compileCommand(doc, { type: 'node.create', node: n }),
    ).not.toThrow();
  });
});

describe('node.move — applies delta to every id', () => {
  it('moves each node by (dx, dy)', () => {
    const doc = docWith(
      node('n1', { x: 10, y: 20 }),
      node('n2', { x: 30, y: 40 }),
    );
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
      e1: {
        id: 'e1',
        from: { node: 'n1', anchor: 'auto' },
        to: { node: 'n2', anchor: 'auto' },
      },
      e2: {
        id: 'e2',
        from: { node: 'n2', anchor: 'auto' },
        to: { node: 'n3', anchor: 'auto' },
      },
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
      e1: {
        id: 'e1',
        from: { node: 'n1', anchor: 'auto' },
        to: { node: 'n2', anchor: 'auto' },
      },
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

  it('deleting a group\'s last member deletes the group in the same patch (T-024)', () => {
    const doc = docWith(node('n1'), node('n2'));
    doc.groups = { g1: { id: 'g1', name: 'g' } };
    doc.nodes.n1!.groupId = 'g1';
    const patch = compileCommand(doc, { type: 'node.delete', ids: ['n1'] });
    expect(patch.groups).toEqual({ g1: { before: { id: 'g1', name: 'g' } } });
    // One undo restores the node AND the group.
    const undone = applyPatch(applyPatch(doc, patch), invertPatch(patch));
    expect(deepEqual(undone, doc)).toBe(true);
  });

  it('a group with a remaining member is untouched by a delete (T-024)', () => {
    const doc = docWith(node('n1'), node('n2'), node('n3'));
    doc.groups = { g1: { id: 'g1', name: 'g' } };
    doc.nodes.n1!.groupId = 'g1';
    doc.nodes.n2!.groupId = 'g1';
    const patch = compileCommand(doc, { type: 'node.delete', ids: ['n1'] });
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
      compileCommand(docWith(node('n1')), {
        type: 'node.delete',
        ids: ['nope'],
      }),
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

// --- T-009 R2: edge.create ---

describe('edge.create — adds the edge, touches nothing else', () => {
  it('patch contains only the new edge', () => {
    const doc = deepFreeze(docWith(node('n1'), node('n2')));
    const e = deepFreeze(edge('e1', 'n1', 'n2'));
    const patch = compileCommand(doc, { type: 'edge.create', edge: e });
    expect(patch.edges.e1).toEqual({ after: e });
    expect(patch.nodes).toEqual({});
    expect(patch.groups).toEqual({});
    expect(patch.order).toBeUndefined();
  });

  it('nodes, groups and order keep their references after applyPatch', () => {
    const doc = docWith(node('n1'), node('n2'));
    const patch = compileCommand(doc, {
      type: 'edge.create',
      edge: edge('e1', 'n1', 'n2'),
    });
    const next = applyPatch(doc, patch);
    expect(next.nodes).toBe(doc.nodes);
    expect(next.groups).toBe(doc.groups);
    expect(next.order).toBe(doc.order);
    expect(next.edges).not.toBe(doc.edges);
    expect(next.edges.e1).toEqual(edge('e1', 'n1', 'n2'));
  });

  it('the resulting doc passes validateDoc', () => {
    const doc = docWith(node('n1'), node('n2'));
    const patch = compileCommand(doc, {
      type: 'edge.create',
      edge: edge('e1', 'n1', 'n2', { label: 'link' }),
    });
    expect(validateDoc(applyPatch(doc, patch))).toEqual([]);
  });

  it('every fixed anchor is accepted', () => {
    const doc = docWith(node('n1'), node('n2'));
    for (const anchor of ['top', 'right', 'bottom', 'left'] as const) {
      const patch = compileCommand(doc, {
        type: 'edge.create',
        edge: edge('e1', 'n1', 'n2', {
          from: { node: 'n1', anchor },
          to: { node: 'n2', anchor },
        }),
      });
      expect(validateDoc(applyPatch(doc, patch))).toEqual([]);
    }
  });

  it('undo (invertPatch) restores the previous doc exactly', () => {
    const doc = docWith(node('n1'), node('n2'));
    doc.edges.e0 = edge('e0', 'n2', 'n1');
    const patch = compileCommand(doc, {
      type: 'edge.create',
      edge: edge('e1', 'n1', 'n2', { label: 'x' }),
    });
    const next = applyPatch(doc, patch);
    const restored = applyPatch(next, invertPatch(patch));
    expect(deepEqual(restored, doc)).toBe(true);
  });
});

describe('edge.create — rejects each invalid case', () => {
  it('empty id', () => {
    expect(() =>
      compileCommand(docWith(node('n1'), node('n2')), {
        type: 'edge.create',
        edge: edge('', 'n1', 'n2'),
      }),
    ).toThrow(CommandError);
  });

  it('id already exists (even with a different pair)', () => {
    const doc = docWith(node('n1'), node('n2'));
    doc.edges.e1 = edge('e1', 'n1', 'n2');
    expect(() =>
      compileCommand(doc, {
        type: 'edge.create',
        edge: edge('e1', 'n2', 'n1'),
      }),
    ).toThrow(CommandError);
  });

  it('from.node does not exist', () => {
    expect(() =>
      compileCommand(docWith(node('n1'), node('n2')), {
        type: 'edge.create',
        edge: edge('e1', 'ghost', 'n2'),
      }),
    ).toThrow(CommandError);
  });

  it('to.node does not exist', () => {
    expect(() =>
      compileCommand(docWith(node('n1'), node('n2')), {
        type: 'edge.create',
        edge: edge('e1', 'n1', 'ghost'),
      }),
    ).toThrow(CommandError);
  });

  it('from.node === to.node (self-edge)', () => {
    expect(() =>
      compileCommand(docWith(node('n1'), node('n2')), {
        type: 'edge.create',
        edge: edge('e1', 'n1', 'n1'),
      }),
    ).toThrow(CommandError);
  });

  it('an existing edge has the same (from, to) pair', () => {
    const doc = docWith(node('n1'), node('n2'), node('n3'));
    doc.edges.e1 = edge('e1', 'n1', 'n2');
    expect(() =>
      compileCommand(doc, {
        type: 'edge.create',
        edge: edge('e2', 'n1', 'n2'),
      }),
    ).toThrow(CommandError);
  });

  it('the reverse-direction pair is valid', () => {
    const doc = docWith(node('n1'), node('n2'));
    doc.edges.e1 = edge('e1', 'n1', 'n2');
    expect(() =>
      compileCommand(doc, {
        type: 'edge.create',
        edge: edge('e2', 'n2', 'n1'),
      }),
    ).not.toThrow();
  });

  it('from.anchor is not one of the five', () => {
    expect(() =>
      compileCommand(docWith(node('n1'), node('n2')), {
        type: 'edge.create',
        edge: edge('e1', 'n1', 'n2', {
          from: { node: 'n1', anchor: 'diagonal' as Edge['from']['anchor'] },
        }),
      }),
    ).toThrow(CommandError);
  });

  it('to.anchor is not one of the five', () => {
    expect(() =>
      compileCommand(docWith(node('n1'), node('n2')), {
        type: 'edge.create',
        edge: edge('e1', 'n1', 'n2', {
          to: { node: 'n2', anchor: 'center' as Edge['to']['anchor'] },
        }),
      }),
    ).toThrow(CommandError);
  });

  it('from.anchor missing at runtime is rejected (commands are data)', () => {
    expect(() =>
      compileCommand(docWith(node('n1'), node('n2')), {
        type: 'edge.create',
        edge: edge('e1', 'n1', 'n2', {
          from: { node: 'n1' } as EdgeEndpoint,
        }),
      }),
    ).toThrow(CommandError);
  });

  it('label is present and not a string', () => {
    expect(() =>
      compileCommand(docWith(node('n1'), node('n2')), {
        type: 'edge.create',
        edge: edge('e1', 'n1', 'n2', { label: 42 as unknown as string }),
      }),
    ).toThrow(CommandError);
  });

  it('a missing from endpoint object throws CommandError, not TypeError', () => {
    expect(() =>
      compileCommand(docWith(node('n1'), node('n2')), {
        type: 'edge.create',
        edge: edge('e1', 'n1', 'n2', {
          from: undefined as unknown as EdgeEndpoint,
        }),
      }),
    ).toThrow(CommandError);
  });
});

// --- T-009 R2: edge.delete ---

describe('edge.delete — removes the listed edges', () => {
  function docWithEdges(): Doc {
    const doc = docWith(node('n1'), node('n2'), node('n3'));
    doc.edges = {
      e1: edge('e1', 'n1', 'n2'),
      e2: edge('e2', 'n2', 'n3'),
      e3: edge('e3', 'n3', 'n1'),
    };
    return doc;
  }

  it('each edge is removed with its before', () => {
    const doc = deepFreeze(docWithEdges());
    const patch = compileCommand(doc, {
      type: 'edge.delete',
      ids: ['e1', 'e3'],
    });
    expect(patch.edges.e1).toEqual({ before: doc.edges.e1 });
    expect(patch.edges.e3).toEqual({ before: doc.edges.e3 });
    expect(patch.edges.e2).toBeUndefined();
    expect(patch.nodes).toEqual({});
    expect(patch.groups).toEqual({});
    expect(patch.order).toBeUndefined();
    const next = applyPatch(doc, patch);
    expect(Object.keys(next.edges)).toEqual(['e2']);
  });

  it('nodes and order keep their references after applyPatch', () => {
    const doc = docWithEdges();
    const patch = compileCommand(doc, { type: 'edge.delete', ids: ['e1'] });
    const next = applyPatch(doc, patch);
    expect(next.nodes).toBe(doc.nodes);
    expect(next.groups).toBe(doc.groups);
    expect(next.order).toBe(doc.order);
  });

  it('the resulting doc passes validateDoc', () => {
    const doc = docWithEdges();
    const patch = compileCommand(doc, {
      type: 'edge.delete',
      ids: ['e1', 'e2'],
    });
    expect(validateDoc(applyPatch(doc, patch))).toEqual([]);
  });

  it('undo (invertPatch) restores the previous doc exactly', () => {
    const doc = docWithEdges();
    const patch = compileCommand(doc, {
      type: 'edge.delete',
      ids: ['e1', 'e3'],
    });
    const next = applyPatch(doc, patch);
    const restored = applyPatch(next, invertPatch(patch));
    expect(deepEqual(restored, doc)).toBe(true);
  });

  it('empty ids returns an empty patch', () => {
    const patch = compileCommand(docWithEdges(), {
      type: 'edge.delete',
      ids: [],
    });
    expect(isEmptyPatch(patch)).toBe(true);
  });

  it('duplicates are ignored (first occurrence wins)', () => {
    const patch = compileCommand(docWithEdges(), {
      type: 'edge.delete',
      ids: ['e1', 'e1'],
    });
    expect(Object.keys(patch.edges)).toEqual(['e1']);
  });

  it('unknown id throws', () => {
    expect(() =>
      compileCommand(docWithEdges(), { type: 'edge.delete', ids: ['ghost'] }),
    ).toThrow(CommandError);
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

describe('node.update — content patch (T-019, M7)', () => {
  it('changes text, color and tags of every listed node in one patch', () => {
    const doc = docWith(node('a'), node('b'));
    const patch = compileCommand(doc, {
      type: 'node.update',
      ids: ['a', 'b'],
      patch: { text: 'hello', color: '#ff0', tags: ['x'] },
    });
    const next = applyPatch(doc, patch);
    for (const id of ['a', 'b']) {
      expect(next.nodes[id]!.text).toBe('hello');
      expect(next.nodes[id]!.color).toBe('#ff0');
      expect(next.nodes[id]!.tags).toEqual(['x']);
      // Geometry untouched.
      expect(next.nodes[id]!.x).toBe(0);
      expect(next.nodes[id]!.w).toBe(100);
    }
    expect(validateDoc(next)).toEqual([]);
  });

  it('applies only the provided fields', () => {
    const doc = docWith(node('a', { text: 'keep', color: '#123' }));
    const patch = compileCommand(doc, {
      type: 'node.update',
      ids: ['a'],
      patch: { color: '#abc' },
    });
    const next = applyPatch(doc, patch);
    expect(next.nodes['a']!.text).toBe('keep');
    expect(next.nodes['a']!.color).toBe('#abc');
  });

  it('a patch that changes nothing compiles to an empty patch', () => {
    const doc = docWith(node('a', { text: 'same', tags: ['t'] }));
    const patch = compileCommand(doc, {
      type: 'node.update',
      ids: ['a'],
      patch: { text: 'same' },
    });
    expect(isEmptyPatch(patch)).toBe(true);
  });

  it('a tags array with equal content but a different reference is a no-op (D-22)', () => {
    // The caller supplies a fresh array (e.g. a deserialized patch or a UI
    // rebuild). Content-equal tags must compile to an empty patch — a
    // reference-equality check would create a phantom undo step that undoes
    // nothing (D-22: a no-op command compiles to an empty patch).
    const doc = docWith(node('a', { tags: ['x', 'y'] }));
    const patch = compileCommand(doc, {
      type: 'node.update',
      ids: ['a'],
      patch: { tags: ['x', 'y'] },
    });
    expect(isEmptyPatch(patch)).toBe(true);
  });

  it('a tags array with different content is a change', () => {
    const doc = docWith(node('a', { tags: ['x'] }));
    const patch = compileCommand(doc, {
      type: 'node.update',
      ids: ['a'],
      patch: { tags: ['x', 'y'] },
    });
    expect(isEmptyPatch(patch)).toBe(false);
    const next = applyPatch(doc, patch);
    expect(next.nodes['a']!.tags).toEqual(['x', 'y']);
  });

  it('empty ids compile to an empty patch', () => {
    const doc = docWith(node('a'));
    const patch = compileCommand(doc, {
      type: 'node.update',
      ids: [],
      patch: { text: 'x' },
    });
    expect(isEmptyPatch(patch)).toBe(true);
  });

  it('unknown ids throw CommandError', () => {
    const doc = docWith(node('a'));
    expect(() =>
      compileCommand(doc, { type: 'node.update', ids: ['ghost'], patch: { text: 'x' } }),
    ).toThrow(CommandError);
  });

  it('invalid patch values throw CommandError', () => {
    const doc = docWith(node('a'));
    expect(() =>
      compileCommand(doc, {
        type: 'node.update',
        ids: ['a'],
        patch: { text: 42 as unknown as string },
      }),
    ).toThrow(CommandError);
    expect(() =>
      compileCommand(doc, {
        type: 'node.update',
        ids: ['a'],
        patch: { tags: 'nope' as unknown as string[] },
      }),
    ).toThrow(CommandError);
  });

  it('do → undo restores the exact original document', () => {
    const doc = docWith(node('a', { text: 'one', color: '#111', tags: ['t1'] }));
    const patch = compileCommand(doc, {
      type: 'node.update',
      ids: ['a'],
      patch: { text: 'two', color: '#222', tags: ['t2', 't3'] },
    });
    const next = applyPatch(doc, patch);
    const undone = applyPatch(next, invertPatch(patch));
    expect(deepEqual(undone, doc)).toBe(true);
  });

  it('duplicated ids are applied once (first occurrence wins)', () => {
    const doc = docWith(node('a'));
    const patch = compileCommand(doc, {
      type: 'node.update',
      ids: ['a', 'a'],
      patch: { text: 'x' },
    });
    expect(Object.keys(patch.nodes)).toEqual(['a']);
  });
});

describe('node.resize — geometry (T-019, M7)', () => {
  it('sets x, y, w and h', () => {
    const doc = docWith(node('a', { x: 0, y: 0, w: 100, h: 50 }));
    const patch = compileCommand(doc, {
      type: 'node.resize',
      id: 'a',
      x: 10,
      y: 20,
      w: 300,
      h: 150,
    });
    const next = applyPatch(doc, patch);
    expect(next.nodes['a']).toMatchObject({ x: 10, y: 20, w: 300, h: 150 });
    expect(validateDoc(next)).toEqual([]);
  });

  it('a no-change resize compiles to an empty patch', () => {
    const doc = docWith(node('a', { x: 5, y: 6, w: 100, h: 50 }));
    const patch = compileCommand(doc, {
      type: 'node.resize',
      id: 'a',
      x: 5,
      y: 6,
      w: 100,
      h: 50,
    });
    expect(isEmptyPatch(patch)).toBe(true);
  });

  it('unknown id and non-finite or non-positive sizes throw', () => {
    const doc = docWith(node('a'));
    expect(() =>
      compileCommand(doc, { type: 'node.resize', id: 'ghost', x: 0, y: 0, w: 1, h: 1 }),
    ).toThrow(CommandError);
    expect(() =>
      compileCommand(doc, { type: 'node.resize', id: 'a', x: NaN, y: 0, w: 1, h: 1 }),
    ).toThrow(CommandError);
    expect(() =>
      compileCommand(doc, { type: 'node.resize', id: 'a', x: 0, y: 0, w: 0, h: 1 }),
    ).toThrow(CommandError);
    expect(() =>
      compileCommand(doc, { type: 'node.resize', id: 'a', x: 0, y: 0, w: 1, h: -5 }),
    ).toThrow(CommandError);
  });

  it('do → undo restores the exact original geometry', () => {
    const doc = docWith(node('a', { x: 0, y: 0, w: 100, h: 50 }));
    const patch = compileCommand(doc, {
      type: 'node.resize',
      id: 'a',
      x: -10,
      y: 40,
      w: 12,
      h: 34,
    });
    const undone = applyPatch(applyPatch(doc, patch), invertPatch(patch));
    expect(deepEqual(undone, doc)).toBe(true);
  });
});

describe('node.create — image src field (T-023)', () => {
  it('accepts an image node with a data-URL src', () => {
    const doc = docWith();
    const patch = compileCommand(doc, {
      type: 'node.create',
      node: node('img', { kind: 'image', src: 'data:image/png;base64,AAAA' }),
    });
    const next = applyPatch(doc, patch);
    expect(next.nodes['img']!.src).toBe('data:image/png;base64,AAAA');
    expect(validateDoc(next)).toEqual([]);
  });

  it('rejects a non-string src', () => {
    const doc = docWith();
    expect(() =>
      compileCommand(doc, {
        type: 'node.create',
        node: node('img', { kind: 'image', src: 42 as unknown as string }),
      }),
    ).toThrow(CommandError);
  });

  it('validateDoc flags a non-string src as bad-src', () => {
    const bad = docWith(
      node('img', { kind: 'image', src: true as unknown as string }),
    );
    const errors = validateDoc(bad);
    expect(errors.some((e) => e.startsWith('bad-src:'))).toBe(true);
  });

  it('duplicate copies the src (the data URL is shared, immutable)', () => {
    const doc = docWith(
      node('img', { kind: 'image', src: 'data:image/png;base64,AAAA' }),
    );
    const patch = compileCommand(doc, {
      type: 'node.duplicate',
      ids: ['img'],
      newIds: ['img2'],
      newEdgeIds: [],
    });
    const next = applyPatch(doc, patch);
    expect(next.nodes['img2']!.src).toBe('data:image/png;base64,AAAA');
  });
});

describe('node.duplicate — z-order of the copies', () => {
  it('each copy is inserted directly after its original (bottom → top)', () => {
    // order: a, b, c (c on top). Duplicating a and b must give
    // a, a2, b, b2, c — every copy right after its original, relative
    // order of the copies preserved, nothing jumping above c.
    const doc = docWith(node('a'), node('b'), node('c'));
    const patch = compileCommand(doc, {
      type: 'node.duplicate',
      ids: ['a', 'b'],
      newIds: ['a2', 'b2'],
      newEdgeIds: [],
    });
    expect(patch.order).toEqual({
      before: ['a', 'b', 'c'],
      after: ['a', 'a2', 'b', 'b2', 'c'],
    });
    const next = applyPatch(doc, patch);
    expect(next.order).toEqual(['a', 'a2', 'b', 'b2', 'c']);
    expect(validateDoc(next)).toEqual([]);
  });

  it('works when the selection order is the reverse of the z-order', () => {
    // Picking b first, then a: each copy still lands right after its
    // original → a, a2, b, b2, c.
    const doc = docWith(node('a'), node('b'), node('c'));
    const patch = compileCommand(doc, {
      type: 'node.duplicate',
      ids: ['b', 'a'],
      newIds: ['b2', 'a2'],
      newEdgeIds: [],
    });
    const next = applyPatch(doc, patch);
    expect(next.order).toEqual(['a', 'a2', 'b', 'b2', 'c']);
  });

  it('a single copy is inserted directly after its original', () => {
    const doc = docWith(node('a'), node('b'));
    const patch = compileCommand(doc, {
      type: 'node.duplicate',
      ids: ['a'],
      newIds: ['a2'],
      newEdgeIds: [],
    });
    const next = applyPatch(doc, patch);
    expect(next.order).toEqual(['a', 'a2', 'b']);
  });
});

describe('node.zOrder — z-order commands', () => {
  it('front moves the selection to the top, preserving relative order', () => {
    const doc = docWith(node('a'), node('b'), node('c'), node('d'));
    const patch = compileCommand(doc, {
      type: 'node.zOrder',
      ids: ['b', 'a'],
      mode: 'front',
    });
    const next = applyPatch(doc, patch);
    expect(next.order).toEqual(['c', 'd', 'b', 'a']);
  });

  it('back moves the selection to the bottom, preserving relative order', () => {
    const doc = docWith(node('a'), node('b'), node('c'), node('d'));
    const patch = compileCommand(doc, {
      type: 'node.zOrder',
      ids: ['d', 'c'],
      mode: 'back',
    });
    const next = applyPatch(doc, patch);
    expect(next.order).toEqual(['d', 'c', 'a', 'b']);
  });

  it('front when already at the front is a no-op → empty patch (D-22)', () => {
    const doc = docWith(node('a'), node('b'), node('c'));
    const patch = compileCommand(doc, {
      type: 'node.zOrder',
      ids: ['b', 'c'],
      mode: 'front',
    });
    expect(isEmptyPatch(patch)).toBe(true);
  });

  it('back when already at the back is a no-op → empty patch (D-22)', () => {
    const doc = docWith(node('a'), node('b'), node('c'));
    const patch = compileCommand(doc, {
      type: 'node.zOrder',
      ids: ['a', 'b'],
      mode: 'back',
    });
    expect(isEmptyPatch(patch)).toBe(true);
  });

  it('forward at the very top is a no-op → empty patch (D-22)', () => {
    const doc = docWith(node('a'), node('b'), node('c'));
    const patch = compileCommand(doc, {
      type: 'node.zOrder',
      ids: ['c'],
      mode: 'forward',
    });
    expect(isEmptyPatch(patch)).toBe(true);
  });

  it('backward at the very bottom is a no-op → empty patch (D-22)', () => {
    const doc = docWith(node('a'), node('b'), node('c'));
    const patch = compileCommand(doc, {
      type: 'node.zOrder',
      ids: ['a'],
      mode: 'backward',
    });
    expect(isEmptyPatch(patch)).toBe(true);
  });

  it('a real reorder is not a no-op and undoes cleanly', () => {
    const doc = docWith(node('a'), node('b'), node('c'));
    const patch = compileCommand(doc, {
      type: 'node.zOrder',
      ids: ['a'],
      mode: 'front',
    });
    expect(isEmptyPatch(patch)).toBe(false);
    const next = applyPatch(doc, patch);
    expect(next.order).toEqual(['b', 'c', 'a']);
    const undone = applyPatch(next, invertPatch(patch));
    expect(deepEqual(undone, doc)).toBe(true);
  });

  it('unknown ids throw CommandError', () => {
    const doc = docWith(node('a'));
    expect(() =>
      compileCommand(doc, { type: 'node.zOrder', ids: ['ghost'], mode: 'front' }),
    ).toThrow(CommandError);
  });

  it('empty ids compile to an empty patch', () => {
    const doc = docWith(node('a'));
    const patch = compileCommand(doc, {
      type: 'node.zOrder',
      ids: [],
      mode: 'front',
    });
    expect(isEmptyPatch(patch)).toBe(true);
  });
});

describe('group.assign — create a group and frame the nodes (T-024, M7)', () => {
  it('creates the group and sets groupId on every node in one patch', () => {
    const doc = docWith(node('a'), node('b'), node('c'));
    const patch = compileCommand(doc, {
      type: 'group.assign',
      groupId: 'g1',
      name: 'My frame',
      ids: ['a', 'b'],
    });
    const next = applyPatch(doc, patch);
    expect(next.groups['g1']).toEqual({ id: 'g1', name: 'My frame' });
    expect(next.nodes['a']!.groupId).toBe('g1');
    expect(next.nodes['b']!.groupId).toBe('g1');
    expect(next.nodes['c']!.groupId).toBeUndefined();
    expect(validateDoc(next)).toEqual([]);
  });

  it('do → undo restores the exact original document', () => {
    const doc = docWith(node('a'), node('b'));
    const patch = compileCommand(doc, {
      type: 'group.assign',
      groupId: 'g1',
      name: 'g',
      ids: ['a', 'b'],
    });
    const undone = applyPatch(applyPatch(doc, patch), invertPatch(patch));
    expect(deepEqual(undone, doc)).toBe(true);
  });

  it('an empty id list compiles to an empty patch (no orphan groups)', () => {
    const doc = docWith(node('a'));
    const patch = compileCommand(doc, {
      type: 'group.assign',
      groupId: 'g1',
      name: 'g',
      ids: [],
    });
    expect(isEmptyPatch(patch)).toBe(true);
  });

  it('unknown ids and duplicate group ids throw', () => {
    const doc = docWith(node('a'));
    doc.groups = { g1: { id: 'g1', name: 'x' } };
    expect(() =>
      compileCommand(doc, { type: 'group.assign', groupId: 'g1', name: 'y', ids: ['a'] }),
    ).toThrow(CommandError);
    expect(() =>
      compileCommand(doc, { type: 'group.assign', groupId: 'g2', name: 'y', ids: ['ghost'] }),
    ).toThrow(CommandError);
    expect(() =>
      compileCommand(doc, { type: 'group.assign', groupId: '', name: 'y', ids: ['a'] }),
    ).toThrow(CommandError);
  });

  it('re-assigning a node from another group moves it', () => {
    const doc = docWith(node('a'), node('b'));
    doc.groups = { g1: { id: 'g1', name: 'one' } };
    doc.nodes['a']!.groupId = 'g1';
    const next = applyPatch(
      doc,
      compileCommand(doc, { type: 'group.assign', groupId: 'g2', name: 'two', ids: ['a'] }),
    );
    expect(next.nodes['a']!.groupId).toBe('g2');
    expect(next.groups['g1']).toEqual({ id: 'g1', name: 'one' });
    expect(validateDoc(next)).toEqual([]);
  });
});

describe('group.unassign — remove memberships (T-024, M7)', () => {
  function groupedDoc(): Doc {
    const doc = docWith(node('a'), node('b'), node('c'));
    doc.groups = { g1: { id: 'g1', name: 'one' } };
    doc.nodes['a']!.groupId = 'g1';
    doc.nodes['b']!.groupId = 'g1';
    return doc;
  }

  it('clears groupId on the listed nodes only', () => {
    const doc = groupedDoc();
    const next = applyPatch(
      doc,
      compileCommand(doc, { type: 'group.unassign', ids: ['a'] }),
    );
    expect(next.nodes['a']!.groupId).toBeUndefined();
    expect(next.nodes['b']!.groupId).toBe('g1');
    expect(next.groups['g1']).toBeDefined();
    expect(validateDoc(next)).toEqual([]);
  });

  it('a group left empty is deleted in the same patch (one undo)', () => {
    const doc = groupedDoc();
    const patch = compileCommand(doc, {
      type: 'group.unassign',
      ids: ['a', 'b'],
    });
    const next = applyPatch(doc, patch);
    expect(next.groups).toEqual({});
    expect(next.nodes['a']!.groupId).toBeUndefined();
    expect(next.nodes['b']!.groupId).toBeUndefined();
    // One undo restores both memberships AND the group.
    const undone = applyPatch(next, invertPatch(patch));
    expect(deepEqual(undone, doc)).toBe(true);
  });

  it('ungrouped ids are a no-op; unknown ids throw', () => {
    const doc = groupedDoc();
    expect(
      isEmptyPatch(compileCommand(doc, { type: 'group.unassign', ids: ['c'] })),
    ).toBe(true);
    expect(() =>
      compileCommand(doc, { type: 'group.unassign', ids: ['ghost'] }),
    ).toThrow(CommandError);
  });
});

describe('group frame geometry (T-024)', () => {
  it('groupFrameRect wraps the members plus padding', () => {
    const doc = docWith(
      node('a', { x: 0, y: 0, w: 100, h: 50 }),
      node('b', { x: 200, y: 300, w: 100, h: 50 }),
    );
    doc.groups = { g1: { id: 'g1', name: 'g' } };
    doc.nodes['a']!.groupId = 'g1';
    doc.nodes['b']!.groupId = 'g1';
    const rect = groupFrameRect(doc, 'g1');
    expect(rect).toEqual({
      x: 0 - GROUP_FRAME_PADDING,
      y: 0 - GROUP_FRAME_PADDING,
      w: 300 + GROUP_FRAME_PADDING * 2,
      h: 350 + GROUP_FRAME_PADDING * 2,
    });
    expect(groupFrameRect(doc, 'nope')).toBeNull();
  });

  it('groupMembersOf lists the members in order; [] when ungrouped', () => {
    const doc = docWith(node('a'), node('b'), node('c'));
    doc.groups = { g1: { id: 'g1', name: 'g' } };
    doc.nodes['b']!.groupId = 'g1';
    doc.nodes['c']!.groupId = 'g1';
    expect(groupMembersOf(doc, 'b')).toEqual(['b', 'c']);
    expect(groupMembersOf(doc, 'a')).toEqual([]);
  });

  it('groupFrameAt finds the frame containing a point', () => {
    const doc = docWith(node('a', { x: 0, y: 0, w: 100, h: 50 }));
    doc.groups = { g1: { id: 'g1', name: 'g' } };
    doc.nodes['a']!.groupId = 'g1';
    // Inside the padding ring around the node: (−8, −8).
    expect(groupFrameAt(doc, { x: -8, y: -8 })).toBe('g1');
    // Far outside.
    expect(groupFrameAt(doc, { x: 500, y: 500 })).toBeNull();
  });
});
