// T-029 — `batch` command unit tests (M9).
//
// The contract: one batch dispatch is ONE patch, so one undo step. Each
// sub-command compiles against the document produced by the previous ones;
// per entity the first `before` and the last `after` survive; create-then-
// delete inside a batch is invisible; an invalid sub-command throws
// CommandError before anything is applied.
import { describe, expect, it } from 'vitest';

import type { Command, Doc, Edge, Node } from './types';
import { emptyDoc, validateDoc } from './doc';
import { applyPatch, invertPatch, isEmptyPatch } from './patch';
import { CommandError, compileCommand } from './commands';
import { createDocStore } from './store';

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

function edge(id: string, from: string, to: string): Edge {
  return { id, from: { node: from, anchor: 'auto' }, to: { node: to, anchor: 'auto' } };
}

describe('batch — one patch for several commands', () => {
  it('create node + edge in one batch touches both maps and order once', () => {
    const doc = docWith(node('root'));
    const child = node('child', { x: 300 });
    const commands: Command[] = [
      { type: 'node.create', node: child },
      { type: 'edge.create', edge: edge('e1', 'root', 'child') },
    ];
    const patch = compileCommand(doc, { type: 'batch', commands });

    expect(patch.nodes.child).toEqual({ after: child });
    expect(patch.edges.e1).toEqual({ after: edge('e1', 'root', 'child') });
    expect(patch.order).toEqual({ before: ['root'], after: ['root', 'child'] });

    const next = applyPatch(doc, patch);
    expect(validateDoc(next)).toEqual([]);
    expect(next.nodes.child).toEqual(child);
    expect(next.edges.e1).toEqual(edge('e1', 'root', 'child'));
  });

  it('create-then-update collapses to a single create with the final value', () => {
    const doc = docWith();
    const commands: Command[] = [
      { type: 'node.create', node: node('n1') },
      { type: 'node.update', ids: ['n1'], patch: { text: 'renamed' } },
    ];
    const patch = compileCommand(doc, { type: 'batch', commands });

    // `before` is absent: the node did not exist in the pre-batch document.
    expect(patch.nodes.n1).toEqual({
      after: node('n1', { text: 'renamed' }),
    });
    const next = applyPatch(doc, patch);
    expect(next.nodes.n1?.text).toBe('renamed');
  });

  it('create-then-delete inside one batch compiles to an empty patch', () => {
    const doc = docWith(node('keep'));
    const commands: Command[] = [
      { type: 'node.create', node: node('ghost') },
      { type: 'node.delete', ids: ['ghost'] },
    ];
    const patch = compileCommand(doc, { type: 'batch', commands });
    expect(isEmptyPatch(patch)).toBe(true);
  });

  it('delete-then-recreate keeps before and after (a real change)', () => {
    const original = node('n1', { x: 0 });
    const doc = docWith(original);
    const commands: Command[] = [
      { type: 'node.delete', ids: ['n1'] },
      { type: 'node.create', node: node('n1', { x: 500 }) },
    ];
    const patch = compileCommand(doc, { type: 'batch', commands });

    expect(patch.nodes.n1).toEqual({ before: original, after: node('n1', { x: 500 }) });
    // The order array is identical before and after, so the merged patch
    // carries no order entry (a no-op part, D-22).
    expect(patch.order).toBeUndefined();
    expect(isEmptyPatch(patch)).toBe(false);
  });

  it('two updates of the same node keep the original before and final after', () => {
    const doc = docWith(node('n1', { text: 'a' }));
    const commands: Command[] = [
      { type: 'node.update', ids: ['n1'], patch: { text: 'b' } },
      { type: 'node.update', ids: ['n1'], patch: { text: 'c' } },
    ];
    const patch = compileCommand(doc, { type: 'batch', commands });
    expect(patch.nodes.n1).toEqual({
      before: node('n1', { text: 'a' }),
      after: node('n1', { text: 'c' }),
    });
  });

  it('a move compiled against the in-batch document (chained deltas)', () => {
    const doc = docWith(node('n1', { x: 0, y: 0 }));
    const commands: Command[] = [
      { type: 'node.move', ids: ['n1'], dx: 10, dy: 0 },
      { type: 'node.move', ids: ['n1'], dx: 15, dy: 5 },
    ];
    const patch = compileCommand(doc, { type: 'batch', commands });
    expect(patch.nodes.n1).toEqual({
      before: node('n1', { x: 0, y: 0 }),
      after: node('n1', { x: 25, y: 5 }),
    });
  });

  it('nested batches compile like flat ones', () => {
    const doc = docWith(node('root'));
    const child = node('child', { x: 300 });
    const patch = compileCommand(doc, {
      type: 'batch',
      commands: [
        {
          type: 'batch',
          commands: [{ type: 'node.create', node: child }],
        },
        { type: 'edge.create', edge: edge('e1', 'root', 'child') },
      ],
    });
    expect(patch.nodes.child).toEqual({ after: child });
    expect(patch.edges.e1).toEqual({ after: edge('e1', 'root', 'child') });
    expect(patch.order).toEqual({ before: ['root'], after: ['root', 'child'] });
  });

  it('an empty commands array is a no-op (empty patch)', () => {
    const doc = docWith(node('n1'));
    const patch = compileCommand(doc, { type: 'batch', commands: [] });
    expect(isEmptyPatch(patch)).toBe(true);
  });

  it('no-op sub-commands keep the batch a no-op', () => {
    const doc = docWith(node('n1'));
    const patch = compileCommand(doc, {
      type: 'batch',
      commands: [{ type: 'node.move', ids: ['n1'], dx: 0, dy: 0 }],
    });
    expect(isEmptyPatch(patch)).toBe(true);
  });
});

describe('batch — strictness', () => {
  it('an invalid sub-command throws CommandError and nothing is applied', () => {
    const doc = docWith(node('n1'));
    expect(() =>
      compileCommand(doc, {
        type: 'batch',
        commands: [
          { type: 'node.create', node: node('n2') },
          { type: 'node.create', node: node('n2') }, // duplicate id
        ],
      }),
    ).toThrow(CommandError);
  });

  it('a sub-command referencing an in-batch-created entity is valid', () => {
    const doc = docWith(node('root'));
    const commands: Command[] = [
      { type: 'node.create', node: node('child') },
      // Valid only because the child exists by now:
      { type: 'edge.create', edge: edge('e1', 'root', 'child') },
      { type: 'node.update', ids: ['child'], patch: { text: 'hi' } },
    ];
    const next = applyPatch(doc, compileCommand(doc, { type: 'batch', commands }));
    expect(validateDoc(next)).toEqual([]);
    expect(next.nodes.child?.text).toBe('hi');
  });

  it('rejects a non-array commands value', () => {
    const doc = docWith();
    expect(() =>
      compileCommand(doc, {
        type: 'batch',
        commands: 'nope' as unknown as Command[],
      }),
    ).toThrow(CommandError);
  });

  it('rejects a non-object sub-command entry', () => {
    const doc = docWith();
    expect(() =>
      compileCommand(doc, {
        type: 'batch',
        commands: [null as unknown as Command],
      }),
    ).toThrow(CommandError);
  });
});

describe('batch — undo is one step and exact', () => {
  it('do → undo restores the exact pre-batch document', () => {
    const original = docWith(node('root'));
    const store = createDocStore(original, { now: () => 0 });
    const child = node('child', { x: 300 });
    const commands: Command[] = [
      { type: 'node.create', node: child },
      { type: 'edge.create', edge: edge('e1', 'root', 'child') },
    ];

    store.dispatch({ type: 'batch', commands });
    expect(store.get().nodes.child).toEqual(child);
    expect(store.get().edges.e1).toEqual(edge('e1', 'root', 'child'));
    expect(store.getHistorySize()).toBe(1);

    store.undo();
    expect(store.get().nodes).toEqual(original.nodes);
    expect(store.get().edges).toEqual(original.edges);
    expect(store.get().order).toEqual(original.order);
    expect(validateDoc(store.get())).toEqual([]);
  });

  it('do → undo → redo restores the post-batch document', () => {
    const store = createDocStore(docWith(node('root')), { now: () => 0 });
    const child = node('child', { x: 300 });
    const commands: Command[] = [
      { type: 'node.create', node: child },
      { type: 'edge.create', edge: edge('e1', 'root', 'child') },
    ];

    store.dispatch({ type: 'batch', commands });
    const after = store.get();
    store.undo();
    store.redo();
    expect(store.get()).toEqual(after);
  });

  it('invertPatch of a batch patch round-trips (create-then-update case)', () => {
    const doc = docWith();
    const commands: Command[] = [
      { type: 'node.create', node: node('n1') },
      { type: 'node.update', ids: ['n1'], patch: { text: 'renamed' } },
    ];
    const patch = compileCommand(doc, { type: 'batch', commands });
    const next = applyPatch(doc, patch);
    const back = applyPatch(next, invertPatch(patch));
    expect(back.nodes).toEqual(doc.nodes);
    expect(back.edges).toEqual(doc.edges);
    expect(back.order).toEqual(doc.order);
  });
});
