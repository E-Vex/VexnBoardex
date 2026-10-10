import { describe, expect, it, vi } from 'vitest';

import type { Doc, Node } from './types';
import { deepEqual } from './deepEqual';
import { applyPatch } from './patch';
import { createDocStore } from './store';
import { CommandError } from './commands';

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

function validDoc(): Doc {
  return {
    nodes: { n1: node('n1') },
    edges: {},
    groups: {},
    order: ['n1'],
  };
}

describe('createDocStore — initial doc validated', () => {
  it('throws when the initial doc is invalid', () => {
    const bad: Doc = {
      nodes: { n1: node('n1', { x: NaN }) },
      edges: {},
      groups: {},
      order: ['n1'],
    };
    expect(() => createDocStore(bad)).toThrow();
  });

  it('succeeds when the initial doc is valid', () => {
    expect(() => createDocStore(validDoc())).not.toThrow();
  });
});

describe('dispatch — updates get() and returns the patch', () => {
  it('a create updates the store', () => {
    const store = createDocStore(validDoc());
    const patch = store.dispatch({
      type: 'node.create',
      node: node('n2'),
    });
    expect(patch.nodes.n2).toBeDefined();
    expect(store.get().nodes.n2).toEqual(node('n2'));
    expect(store.get().order).toEqual(['n1', 'n2']);
  });

  it('a move updates the store', () => {
    const store = createDocStore(validDoc());
    store.dispatch({
      type: 'node.move',
      ids: ['n1'],
      dx: 10,
      dy: 20,
    });
    expect(store.get().nodes.n1).toEqual(node('n1', { x: 10, y: 20 }));
  });
});

describe('dispatch — applyPatch(previous, patch) deep-equals the new doc', () => {
  it('create round-trip', () => {
    const store = createDocStore(validDoc());
    const prev = store.get();
    const patch = store.dispatch({ type: 'node.create', node: node('n2') });
    const rebuilt = applyPatch(prev, patch);
    expect(deepEqual(rebuilt, store.get())).toBe(true);
  });

  it('move round-trip', () => {
    const store = createDocStore(validDoc());
    const prev = store.get();
    const patch = store.dispatch({
      type: 'node.move',
      ids: ['n1'],
      dx: 5,
      dy: 5,
    });
    const rebuilt = applyPatch(prev, patch);
    expect(deepEqual(rebuilt, store.get())).toBe(true);
  });
});

describe('dispatch — subscribers receive (doc, patch)', () => {
  it('subscriber is called with the new doc and the patch', () => {
    const store = createDocStore(validDoc());
    const fn = vi.fn();
    store.subscribe(fn);
    const patch = store.dispatch({ type: 'node.create', node: node('n2') });
    expect(fn).toHaveBeenCalledTimes(1);
    const [doc, p] = fn.mock.calls[0]!;
    expect(deepEqual(doc, store.get())).toBe(true);
    expect(deepEqual(p, patch)).toBe(true);
  });

  it('multiple subscribers are called in subscription order', () => {
    const store = createDocStore(validDoc());
    const order: string[] = [];
    store.subscribe(() => order.push('a'));
    store.subscribe(() => order.push('b'));
    store.subscribe(() => order.push('c'));
    store.dispatch({ type: 'node.create', node: node('n2') });
    expect(order).toEqual(['a', 'b', 'c']);
  });
});

describe('dispatch — no notification for an empty patch', () => {
  it('move with dx=0, dy=0 does not notify', () => {
    const store = createDocStore(validDoc());
    const fn = vi.fn();
    store.subscribe(fn);
    store.dispatch({ type: 'node.move', ids: ['n1'], dx: 0, dy: 0 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('move with empty ids does not notify', () => {
    const store = createDocStore(validDoc());
    const fn = vi.fn();
    store.subscribe(fn);
    store.dispatch({ type: 'node.move', ids: [], dx: 5, dy: 5 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('delete with empty ids does not notify', () => {
    const store = createDocStore(validDoc());
    const fn = vi.fn();
    store.subscribe(fn);
    store.dispatch({ type: 'node.delete', ids: [] });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('subscribe — unsubscribe works', () => {
  it('the subscriber stops receiving after unsubscribe', () => {
    const store = createDocStore(validDoc());
    const fn = vi.fn();
    const unsub = store.subscribe(fn);
    store.dispatch({ type: 'node.create', node: node('n2') });
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
    store.dispatch({ type: 'node.create', node: node('n3') });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('dispatch — a throwing command leaves the doc unchanged and notifies nobody', () => {
  it('CommandError does not change the document', () => {
    const store = createDocStore(validDoc());
    const before = store.get();
    expect(() =>
      store.dispatch({ type: 'node.move', ids: ['nope'], dx: 1, dy: 1 }),
    ).toThrow(CommandError);
    expect(store.get()).toBe(before);
  });

  it('CommandError does not notify subscribers', () => {
    const store = createDocStore(validDoc());
    const fn = vi.fn();
    store.subscribe(fn);
    expect(() =>
      store.dispatch({ type: 'node.move', ids: ['nope'], dx: 1, dy: 1 }),
    ).toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  it('unknown command type does not change the document', () => {
    const store = createDocStore(validDoc());
    const before = store.get();
    expect(() =>
      store.dispatch({ type: 'unknown' } as unknown as never),
    ).toThrow();
    expect(store.get()).toBe(before);
  });
});
