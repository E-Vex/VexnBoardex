/**
 * History tests (T-018) — coalescing semantics, undo/redo, transactions.
 *
 * Coalescing rule under test: only `node.move` patches touching the SAME set
 * of node ids merge within the time window. Creates, deletes and moves of
 * different nodes never merge.
 */
import { describe, expect, it } from 'vitest';

import type { Node, NodeKind, Patch } from './types';
import { createHistory } from './history';

/** A deterministic fake clock. */
function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** A minimal valid node. */
function node(id: string, x = 0, y = 0): Node {
  return {
    id,
    kind: 'card' as NodeKind,
    x,
    y,
    w: 100,
    h: 80,
    text: '',
    color: '#ffffff',
    tags: [],
  };
}

/** A node.move-shaped patch: every id before → after at (x + dx, y + dy). */
function movePatch(
  ids: string[],
  from: Record<string, Node>,
  dx: number,
  dy: number,
): Patch {
  const nodes: Patch['nodes'] = {};
  for (const id of ids) {
    const before = from[id] ?? node(id);
    nodes[id] = { before, after: { ...before, x: before.x + dx, y: before.y + dy } };
  }
  return { nodes, edges: {}, groups: {} };
}

/** A node.create-shaped patch. */
function createPatch(n: Node): Patch {
  return { nodes: { [n.id]: { after: n } }, edges: {}, groups: {} };
}

describe('history — coalescing (T-018)', () => {
  it('two rapid moves of the same node coalesce into one entry', () => {
    const clock = fakeClock();
    const h = createHistory({ now: clock.now });
    const a0 = node('a', 0, 0);
    h.push(movePatch(['a'], { a: a0 }, 10, 0));
    h.push(movePatch(['a'], { a: node('a', 10, 0) }, 10, 0));
    expect(h.getPastLength()).toBe(1);
  });

  it('rapid moves of different nodes do NOT coalesce', () => {
    const clock = fakeClock();
    const h = createHistory({ now: clock.now });
    h.push(movePatch(['a'], { a: node('a', 0, 0) }, 10, 0));
    h.push(movePatch(['b'], { b: node('b', 0, 0) }, 10, 0));
    expect(h.getPastLength()).toBe(2);
  });

  it('two rapid creates do NOT coalesce (each is its own undo step)', () => {
    const clock = fakeClock();
    const h = createHistory({ now: clock.now });
    h.push(createPatch(node('a')));
    h.push(createPatch(node('b')));
    expect(h.getPastLength()).toBe(2);
  });

  it('moves of the same node after the window do not coalesce', () => {
    const clock = fakeClock();
    const h = createHistory({ now: clock.now });
    h.push(movePatch(['a'], { a: node('a', 0, 0) }, 10, 0));
    clock.advance(400);
    h.push(movePatch(['a'], { a: node('a', 10, 0) }, 10, 0));
    expect(h.getPastLength()).toBe(2);
  });

  it('a move of [a,b] does not coalesce with a move of [a]', () => {
    const clock = fakeClock();
    const h = createHistory({ now: clock.now });
    h.push(movePatch(['a', 'b'], { a: node('a'), b: node('b') }, 10, 0));
    h.push(movePatch(['a'], { a: node('a', 10, 0) }, 10, 0));
    expect(h.getPastLength()).toBe(2);
  });

  it('undo/redo of a coalesced move spans both deltas', () => {
    const clock = fakeClock();
    const h = createHistory({ now: clock.now });
    const a0 = node('a', 0, 0);
    h.push(movePatch(['a'], { a: a0 }, 10, 0));
    h.push(movePatch(['a'], { a: node('a', 10, 0) }, 10, 0));
    expect(h.getPastLength()).toBe(1);

    const inverse = h.undo()!;
    // Undoing one entry restores the position before BOTH moves.
    expect(inverse.nodes['a']?.before).toEqual(node('a', 20, 0));
    expect(inverse.nodes['a']?.after).toEqual(a0);

    const redo = h.redo()!;
    expect(redo.nodes['a']?.after).toEqual(node('a', 20, 0));
  });
});

describe('history — undo/redo stack behaviour', () => {
  it('push clears the redo stack', () => {
    const clock = fakeClock();
    const h = createHistory({ now: clock.now });
    h.push(movePatch(['a'], { a: node('a') }, 1, 0));
    h.undo();
    expect(h.canRedo()).toBe(true);
    clock.advance(400);
    h.push(movePatch(['a'], { a: node('a') }, 2, 0));
    expect(h.canRedo()).toBe(false);
  });

  it('undo on an empty history returns null', () => {
    const h = createHistory({ now: () => 0 });
    expect(h.undo()).toBeNull();
    expect(h.canUndo()).toBe(false);
  });

  it('empty patches are ignored', () => {
    const h = createHistory({ now: () => 0 });
    h.push({ nodes: {}, edges: {}, groups: {} });
    expect(h.getPastLength()).toBe(0);
  });

  it('clear() empties both stacks', () => {
    const h = createHistory({ now: () => 0 });
    h.push(movePatch(['a'], { a: node('a') }, 1, 0));
    h.undo();
    h.clear();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });
});
