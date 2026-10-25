import { describe, expect, it, vi } from 'vitest';

import type { Doc, Node } from '../core/types';
import { createUiStore, pruneSelection } from './uiStore';

function node(id: string): Node {
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
  };
}

function docOf(...ids: string[]): Doc {
  const doc: Doc = { nodes: {}, edges: {}, groups: {}, order: [] };
  for (const id of ids) {
    doc.nodes[id] = node(id);
    doc.order.push(id);
  }
  return doc;
}

describe('createUiStore — initial state (R3)', () => {
  it('starts with an empty selection and no drag', () => {
    const store = createUiStore();
    expect(store.get()).toEqual({ selection: [], drag: null, boxSelect: null, connect: null });
  });
});

describe('setSelection — notify only on real change (R3)', () => {
  it('stores the selection and notifies once', () => {
    const store = createUiStore();
    const fn = vi.fn();
    store.subscribe(fn);
    store.setSelection(['a']);
    expect(store.get().selection).toEqual(['a']);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({
      selection: ['a'],
      drag: null,
      connect: null,
      boxSelect: null,
    });
  });

  it('the same ids in the same order are not a change', () => {
    const store = createUiStore();
    store.setSelection(['a', 'b']);
    const fn = vi.fn();
    store.subscribe(fn);
    store.setSelection(['a', 'b']);
    expect(fn).not.toHaveBeenCalled();
    expect(store.get().selection).toEqual(['a', 'b']);
  });

  it('the same ids in a different order ARE a change', () => {
    const store = createUiStore();
    store.setSelection(['a', 'b']);
    const fn = vi.fn();
    store.subscribe(fn);
    store.setSelection(['b', 'a']);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(store.get().selection).toEqual(['b', 'a']);
  });

  it('clearing to [] from [] does not notify', () => {
    const store = createUiStore();
    const fn = vi.fn();
    store.subscribe(fn);
    store.setSelection([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('keeps the drag when the selection changes', () => {
    const store = createUiStore();
    store.setDrag({ ids: ['a'], dx: 10, dy: 20 });
    store.setSelection(['a', 'b']);
    expect(store.get()).toEqual({
      selection: ['a', 'b'],
      drag: { ids: ['a'], dx: 10, dy: 20 },
      connect: null,
      boxSelect: null,
    });
  });
});

describe('setDrag — notify only on real change (R3)', () => {
  it('stores the preview and notifies', () => {
    const store = createUiStore();
    const fn = vi.fn();
    store.subscribe(fn);
    store.setDrag({ ids: ['a'], dx: 5, dy: 6 });
    expect(store.get().drag).toEqual({ ids: ['a'], dx: 5, dy: 6 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('setting null when already null does not notify', () => {
    const store = createUiStore();
    const fn = vi.fn();
    store.subscribe(fn);
    store.setDrag(null);
    expect(fn).not.toHaveBeenCalled();
  });

  it('an equal preview (ids, dx, dy) is not a change', () => {
    const store = createUiStore();
    store.setDrag({ ids: ['a'], dx: 5, dy: 6 });
    const fn = vi.fn();
    store.subscribe(fn);
    store.setDrag({ ids: ['a'], dx: 5, dy: 6 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('a different dx or dy is a change', () => {
    const store = createUiStore();
    store.setDrag({ ids: ['a'], dx: 5, dy: 6 });
    const fn = vi.fn();
    store.subscribe(fn);
    store.setDrag({ ids: ['a'], dx: 6, dy: 6 });
    expect(fn).toHaveBeenCalledTimes(1);
    store.setDrag({ ids: ['a'], dx: 6, dy: 7 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('different ids are a change', () => {
    const store = createUiStore();
    store.setDrag({ ids: ['a'], dx: 5, dy: 6 });
    const fn = vi.fn();
    store.subscribe(fn);
    store.setDrag({ ids: ['b'], dx: 5, dy: 6 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('clearing a drag back to null notifies and keeps the selection', () => {
    const store = createUiStore();
    store.setSelection(['a']);
    store.setDrag({ ids: ['a'], dx: 5, dy: 6 });
    const fn = vi.fn();
    store.subscribe(fn);
    store.setDrag(null);
    expect(store.get()).toEqual({ selection: ['a'], drag: null, boxSelect: null, connect: null });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('subscribe — unsubscribe works (R3)', () => {
  it('a removed subscriber is not notified', () => {
    const store = createUiStore();
    const fn = vi.fn();
    const unsub = store.subscribe(fn);
    unsub();
    store.setSelection(['a']);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('pruneSelection (R3)', () => {
  it('keeps ids that exist in the doc, in order', () => {
    const doc = docOf('a', 'b', 'c');
    expect(pruneSelection(['a', 'c'], doc)).toEqual(['a', 'c']);
  });

  it('drops ids that no longer exist', () => {
    const doc = docOf('a', 'c');
    expect(pruneSelection(['a', 'b', 'c'], doc)).toEqual(['a', 'c']);
  });

  it('returns the same array reference when nothing is pruned', () => {
    const doc = docOf('a', 'b');
    const sel = ['a', 'b'];
    expect(pruneSelection(sel, doc)).toBe(sel);
  });

  it('an empty selection stays empty', () => {
    expect(pruneSelection([], docOf('a'))).toEqual([]);
  });

  it('a fully deleted selection becomes empty', () => {
    expect(pruneSelection(['x', 'y'], docOf('a'))).toEqual([]);
  });

  it('works on an empty doc', () => {
    expect(pruneSelection(['x'], docOf())).toEqual([]);
  });
});
