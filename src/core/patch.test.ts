import { describe, expect, it } from 'vitest';

import type { Doc, Node, Patch } from './types';
import { emptyDoc } from './doc';
import { deepEqual } from './deepEqual';
import {
  PatchConflictError,
  applyPatch,
  invertPatch,
  isEmptyPatch,
} from './patch';

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

/** Freeze deeply so any mutation throws (R9). */
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

describe('applyPatch — create (before=undefined, after=node)', () => {
  it('adds a node that does not exist', () => {
    const doc = deepFreeze(emptyDoc());
    const n = deepFreeze(node('n1'));
    const patch: Patch = {
      nodes: { n1: { after: n } },
      edges: {},
      groups: {},
      order: { before: [], after: ['n1'] },
    };
    const result = applyPatch(doc, patch);
    expect(result.nodes.n1).toEqual(n);
    expect(result.order).toEqual(['n1']);
  });
});

describe('applyPatch — modify (before=node, after=node)', () => {
  it('replaces a node when before matches', () => {
    const doc = deepFreeze({
      nodes: { n1: deepFreeze(node('n1', { x: 10 })) },
      edges: {},
      groups: {},
      order: ['n1'],
    });
    const updated = deepFreeze(node('n1', { x: 20 }));
    const patch: Patch = {
      nodes: { n1: { before: node('n1', { x: 10 }), after: updated } },
      edges: {},
      groups: {},
    };
    const result = applyPatch(doc, patch);
    expect(result.nodes.n1).toEqual(updated);
    expect(result.order).toBe(doc.order); // untouched, same ref
  });
});

describe('applyPatch — delete (before=node, after=undefined)', () => {
  it('removes a node when before matches', () => {
    const doc = deepFreeze({
      nodes: {
        n1: deepFreeze(node('n1')),
        n2: deepFreeze(node('n2')),
      },
      edges: {},
      groups: {},
      order: ['n1', 'n2'],
    });
    const patch: Patch = {
      nodes: { n1: { before: node('n1') } },
      edges: {},
      groups: {},
      order: { before: ['n1', 'n2'], after: ['n2'] },
    };
    const result = applyPatch(doc, patch);
    expect(result.nodes.n1).toBeUndefined();
    expect(result.nodes.n2).toBeDefined();
    expect(result.order).toEqual(['n2']);
  });
});

describe('applyPatch — strict mismatch throws PatchConflictError', () => {
  it('wrong before for a node', () => {
    const doc = deepFreeze({
      nodes: { n1: deepFreeze(node('n1', { x: 10 })) },
      edges: {},
      groups: {},
      order: ['n1'],
    });
    const patch: Patch = {
      nodes: { n1: { before: node('n1', { x: 999 }), after: node('n1', { x: 20 }) } },
      edges: {},
      groups: {},
    };
    expect(() => applyPatch(doc, patch)).toThrow(PatchConflictError);
  });

  it('creating an entity that already exists (before=undefined but node exists)', () => {
    const existing = deepFreeze(node('n1'));
    const doc = deepFreeze({
      nodes: { n1: existing },
      edges: {},
      groups: {},
      order: ['n1'],
    });
    const patch: Patch = {
      nodes: { n1: { after: deepFreeze(node('n1')) } },
      edges: {},
      groups: {},
    };
    expect(() => applyPatch(doc, patch)).toThrow(PatchConflictError);
  });

  it('deleting a missing entity (before=node but entity is absent)', () => {
    const doc = deepFreeze(emptyDoc());
    const patch: Patch = {
      nodes: { n1: { before: node('n1') } },
      edges: {},
      groups: {},
    };
    expect(() => applyPatch(doc, patch)).toThrow(PatchConflictError);
  });

  it('wrong order.before', () => {
    const doc = deepFreeze({
      nodes: { n1: deepFreeze(node('n1')) },
      edges: {},
      groups: {},
      order: ['n1'],
    });
    const patch: Patch = {
      nodes: {},
      edges: {},
      groups: {},
      order: { before: ['wrong'], after: ['n1', 'n2'] },
    };
    expect(() => applyPatch(doc, patch)).toThrow(PatchConflictError);
  });
});

describe('applyPatch — structural sharing', () => {
  it('untouched maps keep their reference', () => {
    const doc = deepFreeze<Doc>({
      nodes: { n1: deepFreeze(node('n1')) },
      edges: { e1: deepFreeze({ id: 'e1', from: { node: 'n1', anchor: 'auto' }, to: { node: 'n1', anchor: 'auto' } }) },
      groups: { g1: deepFreeze({ id: 'g1', name: 'g' }) },
      order: ['n1'],
    });
    const patch: Patch = {
      nodes: { n1: { before: node('n1'), after: deepFreeze(node('n1', { x: 50 })) } },
      edges: {},
      groups: {},
    };
    const result = applyPatch(doc, patch);
    expect(result.edges).toBe(doc.edges); // untouched, same ref
    expect(result.groups).toBe(doc.groups); // untouched, same ref
    expect(result.order).toBe(doc.order); // untouched, same ref
    expect(result.nodes).not.toBe(doc.nodes); // touched, new map
  });
});

describe('applyPatch — immutability', () => {
  it('does not mutate the input document or patch', () => {
    const doc = deepFreeze({
      nodes: { n1: deepFreeze(node('n1')) },
      edges: {},
      groups: {},
      order: ['n1'],
    });
    const patch = deepFreeze({
      nodes: { n1: { before: node('n1'), after: node('n1', { x: 50 }) } },
      edges: {},
      groups: {},
    } as Patch);
    const docBefore = JSON.parse(JSON.stringify(doc));
    const patchBefore = JSON.parse(JSON.stringify(patch));
    applyPatch(doc, patch);
    expect(JSON.parse(JSON.stringify(doc))).toEqual(docBefore);
    expect(JSON.parse(JSON.stringify(patch))).toEqual(patchBefore);
  });
});

describe('invertPatch', () => {
  it('create inverts to delete', () => {
    const n = node('n1');
    const patch: Patch = {
      nodes: { n1: { after: n } },
      edges: {},
      groups: {},
      order: { before: [], after: ['n1'] },
    };
    const inv = invertPatch(patch);
    expect(inv.nodes.n1).toEqual({ before: n });
    expect(inv.order).toEqual({ before: ['n1'], after: [] });
  });

  it('delete inverts to create', () => {
    const n = node('n1');
    const patch: Patch = {
      nodes: { n1: { before: n } },
      edges: {},
      groups: {},
      order: { before: ['n1'], after: [] },
    };
    const inv = invertPatch(patch);
    expect(inv.nodes.n1).toEqual({ after: n });
  });

  it('modify inverts before/after', () => {
    const before = node('n1', { x: 10 });
    const after = node('n1', { x: 20 });
    const patch: Patch = {
      nodes: { n1: { before, after } },
      edges: {},
      groups: {},
    };
    const inv = invertPatch(patch);
    expect(inv.nodes.n1).toEqual({ before: after, after: before });
  });

  it('invertPatch(invertPatch(p)) deep-equals p', () => {
    const patch: Patch = {
      nodes: { n1: { before: node('n1', { x: 10 }), after: node('n1', { x: 20 }) } },
      edges: {},
      groups: {},
      order: { before: ['n1'], after: ['n1', 'n2'] },
    };
    const doubleInv = invertPatch(invertPatch(patch));
    expect(deepEqual(doubleInv, patch)).toBe(true);
  });

  it('returns a new object (no mutation)', () => {
    const n = node('n1');
    const patch = deepFreeze({
      nodes: { n1: { after: n } },
      edges: {},
      groups: {},
      order: { before: [], after: ['n1'] },
    } as Patch);
    const inv = invertPatch(patch);
    expect(inv).not.toBe(patch);
    expect(inv.nodes).not.toBe(patch.nodes);
  });
});

describe('isEmptyPatch', () => {
  it('empty maps and no order → true', () => {
    expect(isEmptyPatch({ nodes: {}, edges: {}, groups: {} })).toBe(true);
  });

  it('a node change → false', () => {
    expect(
      isEmptyPatch({ nodes: { n1: { after: node('n1') } }, edges: {}, groups: {} }),
    ).toBe(false);
  });

  it('an edge change → false', () => {
    expect(
      isEmptyPatch({
        nodes: {},
        edges: { e1: { before: { id: 'e1', from: { node: 'a', anchor: 'auto' }, to: { node: 'b', anchor: 'auto' } } } },
        groups: {},
      }),
    ).toBe(false);
  });

  it('an order change → false', () => {
    expect(
      isEmptyPatch({
        nodes: {},
        edges: {},
        groups: {},
        order: { before: [], after: ['n1'] },
      }),
    ).toBe(false);
  });
});

describe('round trip: apply → invert → apply restores the doc', () => {
  it('create + invert + apply = original', () => {
    const doc = deepFreeze({
      nodes: { n1: deepFreeze(node('n1')) },
      edges: {},
      groups: {},
      order: ['n1'],
    });
    const patch: Patch = {
      nodes: { n2: { after: deepFreeze(node('n2')) } },
      edges: {},
      groups: {},
      order: { before: ['n1'], after: ['n1', 'n2'] },
    };
    const next = applyPatch(doc, patch);
    const restored = applyPatch(next, invertPatch(patch));
    expect(deepEqual(restored, doc)).toBe(true);
  });

  it('modify + invert + apply = original', () => {
    const doc = deepFreeze({
      nodes: { n1: deepFreeze(node('n1', { x: 10 })) },
      edges: {},
      groups: {},
      order: ['n1'],
    });
    const patch: Patch = {
      nodes: { n1: { before: node('n1', { x: 10 }), after: node('n1', { x: 99 }) } },
      edges: {},
      groups: {},
    };
    const next = applyPatch(doc, patch);
    const restored = applyPatch(next, invertPatch(patch));
    expect(deepEqual(restored, doc)).toBe(true);
  });

  it('delete + invert + apply = original', () => {
    const doc = deepFreeze({
      nodes: {
        n1: deepFreeze(node('n1')),
        n2: deepFreeze(node('n2')),
      },
      edges: {},
      groups: {},
      order: ['n1', 'n2'],
    });
    const patch: Patch = {
      nodes: { n2: { before: node('n2') } },
      edges: {},
      groups: {},
      order: { before: ['n1', 'n2'], after: ['n1'] },
    };
    const next = applyPatch(doc, patch);
    const restored = applyPatch(next, invertPatch(patch));
    expect(deepEqual(restored, doc)).toBe(true);
  });
});
