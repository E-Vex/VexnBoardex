// T-035 — kanban layout unit tests (M9).
//
// Covers the pure planning math: slot geometry, insertion indices, hit
// helpers, drop/create/board plans — including that every planned batch
// COMPILES against the document (D-22), leaves it valid (D-24) and inverts
// exactly (undo, D-09).

import { describe, expect, it } from 'vitest';

import type { Doc, Node } from './types';
import { emptyDoc, validateDoc } from './doc';
import { applyPatch, invertPatch, isEmptyPatch } from './patch';
import { compileCommand } from './commands';
import { deepEqual } from './deepEqual';
import {
  KANBAN_BOARD_COLUMNS,
  KANBAN_CARD_GAP,
  KANBAN_HEADER_H,
  KANBAN_PADDING,
  columnAt,
  columnCloseHit,
  columnClosePoint,
  columnMembers,
  columnRect,
  columnsOf,
  dragMembersOf,
  insertionIndex,
  isColumn,
  planKanbanBoard,
  planKanbanCreate,
  planKanbanDrop,
  slotPositions,
} from './kanban';

function node(id: string, overrides: Partial<Node> = {}): Node {
  return {
    id,
    kind: 'card',
    x: 0,
    y: 0,
    w: 200,
    h: 120,
    text: '',
    color: '#fff',
    tags: [],
    ...overrides,
  };
}

function column(id: string, x = 0, y = 0, name = 'To Do') {
  return { id, name, role: 'kanban' as const, x, y, w: 240, h: 400 };
}

/** A board with columns c1 (x 0–240) and c2 (x 300–540), optional cards. */
function board(
  cards: Array<{ id: string; col?: 'c1' | 'c2'; y?: number }> = [],
): Doc {
  const doc = emptyDoc();
  doc.groups = { c1: column('c1'), c2: column('c2', 300, 0, 'Doing') };
  for (const c of cards) {
    const n = node(c.id, { x: 16, y: c.y ?? KANBAN_HEADER_H + KANBAN_PADDING });
    if (c.col !== undefined) n.groupId = c.col;
    doc.nodes[c.id] = n;
    doc.order.push(c.id);
  }
  return doc;
}

/** Slot 0 top-left for a column at (0, 0). */
const SLOT0 = { x: KANBAN_PADDING, y: KANBAN_HEADER_H + KANBAN_PADDING };
/** Slot 1 top-left for a column at (0, 0) with 120-high cards. */
const SLOT1 = { x: KANBAN_PADDING, y: SLOT0.y + 120 + KANBAN_CARD_GAP };

describe('kanban — column helpers', () => {
  it('isColumn and columnRect', () => {
    expect(isColumn(column('c1'))).toBe(true);
    expect(isColumn({ id: 'g', name: 'frame' })).toBe(false);
    expect(columnRect(column('c1'))).toEqual({ x: 0, y: 0, w: 240, h: 400 });
    expect(columnRect({ id: 'g', name: 'frame' })).toBeNull();
    expect(columnRect({ id: 'c', name: 'c', role: 'kanban' })).toBeNull();
  });

  it('columnsOf lists columns in insertion order; columnMembers in doc order', () => {
    const doc = board([
      { id: 'a', col: 'c2' },
      { id: 'b', col: 'c1' },
      { id: 'c', col: 'c1' },
    ]);
    expect(columnsOf(doc).map((g) => g.id)).toEqual(['c1', 'c2']);
    expect(columnMembers(doc, 'c1').map((n) => n.id)).toEqual(['b', 'c']);
  });

  it('columnAt finds the column containing the point; later groups win', () => {
    const doc = board();
    expect(columnAt(doc, { x: 10, y: 10 })).toBe('c1');
    expect(columnAt(doc, { x: 310, y: 399 })).toBe('c2');
    expect(columnAt(doc, { x: 250, y: 10 })).toBeNull(); // the gap between
    // An overlapping later column wins.
    doc.groups = { ...doc.groups, c3: column('c3', 100, 0, 'Over') };
    expect(columnAt(doc, { x: 110, y: 10 })).toBe('c3');
  });

  it('columnCloseHit works in screen space at any zoom', () => {
    const doc = board();
    const cp = columnClosePoint(columnRect(column('c1'))!);
    expect(cp).toEqual({ x: 240 - KANBAN_PADDING, y: 18 });
    expect(columnCloseHit(doc, cp, 1)).toBe('c1');
    // 5 world units away at zoom 1 is 5 screen px — inside the 10px radius.
    expect(columnCloseHit(doc, { x: cp.x - 5, y: cp.y }, 1)).toBe('c1');
    // 5 world units at zoom 2 is 10 screen px — still inside (≤).
    expect(columnCloseHit(doc, { x: cp.x - 5, y: cp.y }, 2)).toBe('c1');
    // 9 world units at zoom 2 is 18 screen px — outside.
    expect(columnCloseHit(doc, { x: cp.x - 9, y: cp.y }, 2)).toBeNull();
    // A far point never hits.
    expect(columnCloseHit(doc, { x: 0, y: 300 }, 1)).toBeNull();
  });

  it('dragMembersOf: a kanban card drags alone; regular groups and free nodes keep their rules', () => {
    const doc = board([
      { id: 'a', col: 'c1' },
      { id: 'b', col: 'c1' },
    ]);
    expect(dragMembersOf(doc, 'a')).toEqual([]); // kanban card: alone
    // A regular group still drags together (T-024).
    doc.groups = { ...doc.groups, g1: { id: 'g1', name: 'frame' } };
    doc.nodes.a!.groupId = 'g1';
    doc.nodes.b!.groupId = 'g1';
    expect(dragMembersOf(doc, 'a')).toEqual(['a', 'b']);
    // A free node drags alone.
    doc.nodes.a!.groupId = undefined;
    doc.nodes.b!.groupId = undefined;
    expect(dragMembersOf(doc, 'a')).toEqual([]);
    expect(dragMembersOf(doc, 'nope')).toEqual([]);
  });
});

describe('kanban — slot layout', () => {
  it('slotPositions stacks left-aligned with variable heights', () => {
    const cards = [
      node('a', { h: 120 }),
      node('b', { h: 60 }),
      node('c', { h: 120 }),
    ];
    const rect = { x: 300, y: 100, w: 240, h: 400 };
    const slots = slotPositions(rect, cards);
    expect(slots.get('a')).toEqual({ x: 316, y: 152 });
    expect(slots.get('b')).toEqual({ x: 316, y: 152 + 120 + KANBAN_CARD_GAP });
    expect(slots.get('c')).toEqual({
      x: 316,
      y: 152 + 120 + KANBAN_CARD_GAP + 60 + KANBAN_CARD_GAP,
    });
  });

  it('insertionIndex counts cards at or above the drop centre', () => {
    const a = node('a', { y: 52, h: 120 }); // centre 112
    const b = node('b', { y: 184, h: 120 }); // centre 244
    expect(insertionIndex([a, b], 50)).toBe(0); // above both
    expect(insertionIndex([a, b], 112)).toBe(1); // exactly on a's centre → below a
    expect(insertionIndex([a, b], 200)).toBe(1); // between a and b
    expect(insertionIndex([a, b], 300)).toBe(2); // below both
    expect(insertionIndex([], 300)).toBe(0);
  });
});

describe('planKanbanDrop — snapping into columns', () => {
  it('a free card dropped over an empty column lands in slot 0 and joins it', () => {
    const doc = board([{ id: 'free', col: undefined, y: 1000 }]); // far away, free
    const plan = planKanbanDrop(doc, {
      ids: ['free'],
      dx: -doc.nodes.free!.x + 16,
      dy: -doc.nodes.free!.y + 52,
      primaryId: 'free',
    });
    // Preview glued to the slot.
    expect(plan.preview).toEqual({ dx: SLOT0.x - doc.nodes.free!.x, dy: SLOT0.y - doc.nodes.free!.y });
    const patch = compileCommand(doc, plan.command);
    const next = applyPatch(doc, patch);
    expect(next.nodes.free!.x).toBe(SLOT0.x);
    expect(next.nodes.free!.y).toBe(SLOT0.y);
    expect(next.nodes.free!.groupId).toBe('c1');
    expect(validateDoc(next)).toEqual([]);
  });

  it('a drop above the only existing card inserts at slot 0 and shifts it down', () => {
    // 'new' is a FREE card parked far below; the drag lifts it over c1.
    const doc = board([
      { id: 'a', col: 'c1' }, // a at slot 0 (centre y 112)
      { id: 'new', y: 1000 }, // free, centre (116, 1060)
    ]);
    const plan = planKanbanDrop(doc, {
      ids: ['new'],
      dx: 0,
      dy: -960, // preview centre (116, 100): above a's centre
      primaryId: 'new',
    });
    const next = applyPatch(doc, compileCommand(doc, plan.command));
    expect(next.nodes.new!.y).toBe(SLOT0.y);
    expect(next.nodes.a!.y).toBe(SLOT1.y); // shifted down
    expect(next.nodes.new!.groupId).toBe('c1');
    expect(next.nodes.a!.groupId).toBe('c1');
  });

  it('a drop between two cards inserts between them', () => {
    const doc = board([
      { id: 'a', col: 'c1' }, // slot 0, centre 112
      { id: 'b', col: 'c1', y: SLOT1.y }, // slot 1, centre 244
      { id: 'new', y: 1000 }, // free, parked far below
    ]);
    const plan = planKanbanDrop(doc, {
      ids: ['new'],
      dx: 0,
      dy: -880, // preview centre (116, 180): between 112 and 244 → index 1
      primaryId: 'new',
    });
    const next = applyPatch(doc, compileCommand(doc, plan.command));
    expect(next.nodes.a!.y).toBe(SLOT0.y); // unchanged
    expect(next.nodes.new!.y).toBe(SLOT1.y); // inserted between
    expect(next.nodes.b!.y).toBe(SLOT1.y + 120 + KANBAN_CARD_GAP); // pushed down
  });

  it('reordering within one column swaps slots; membership is untouched', () => {
    const doc = board([
      { id: 'a', col: 'c1' }, // slot 0
      { id: 'b', col: 'c1', y: SLOT1.y }, // slot 1
    ]);
    // Drag a (at slot 0) below b: dy puts its centre below b's centre.
    const plan = planKanbanDrop(doc, {
      ids: ['a'],
      dx: 0,
      dy: 200, // a's centre 112 → 312 > b's 244 → index 1
      primaryId: 'a',
    });
    const next = applyPatch(doc, compileCommand(doc, plan.command));
    expect(next.nodes.b!.y).toBe(SLOT0.y);
    expect(next.nodes.a!.y).toBe(SLOT1.y);
    expect(next.nodes.a!.groupId).toBe('c1');
    expect(next.nodes.b!.groupId).toBe('c1');
  });

  it('a cross-column move also closes the gap in the source column', () => {
    const doc = board([
      { id: 'a', col: 'c1' }, // slot 0 of c1
      { id: 'b', col: 'c1', y: SLOT1.y }, // slot 1 of c1
    ]);
    // Drag a to the top of c2 (x 300–540): dx 340, dy 0 → centre (456, 112) in c2.
    const plan = planKanbanDrop(doc, {
      ids: ['a'],
      dx: 340,
      dy: 0,
      primaryId: 'a',
    });
    const next = applyPatch(doc, compileCommand(doc, plan.command));
    expect(next.nodes.a!.groupId).toBe('c2');
    expect(next.nodes.a!.x).toBe(300 + KANBAN_PADDING); // c2's slot 0
    expect(next.nodes.a!.y).toBe(SLOT0.y);
    expect(next.nodes.b!.groupId).toBe('c1');
    expect(next.nodes.b!.y).toBe(SLOT0.y); // b closed the gap in c1
  });

  it('dropping outside every column clears membership and closes source gaps', () => {
    const doc = board([
      { id: 'a', col: 'c1' }, // slot 0
      { id: 'b', col: 'c1', y: SLOT1.y }, // slot 1
    ]);
    const plan = planKanbanDrop(doc, {
      ids: ['b'],
      dx: 0,
      dy: 800, // far below every column
      primaryId: 'b',
    });
    expect(plan.preview).toBeNull();
    const next = applyPatch(doc, compileCommand(doc, plan.command));
    expect(next.nodes.b!.groupId).toBeUndefined(); // left the column
    expect(next.nodes.b!.y).toBe(SLOT1.y + 800); // the raw move applied
    expect(next.nodes.a!.y).toBe(SLOT0.y); // a stays (already slot 0)
    expect(next.groups.c1).toBeDefined(); // the column survives
  });

  it('a free card dropped outside every column is the plain node.move', () => {
    const doc = board([{ id: 'free', col: undefined, y: 1000 }]);
    const plan = planKanbanDrop(doc, {
      ids: ['free'],
      dx: 30,
      dy: 40,
      primaryId: 'free',
    });
    expect(plan.command).toEqual({ type: 'node.move', ids: ['free'], dx: 30, dy: 40 });
    expect(plan.preview).toBeNull();
  });

  it('a drag involving a regular group member never snaps (T-024 wins)', () => {
    const doc = board([{ id: 'a', col: undefined }, { id: 'b', col: undefined }]);
    doc.groups = { ...doc.groups, g1: { id: 'g1', name: 'frame' } };
    doc.nodes.a!.groupId = 'g1';
    doc.nodes.b!.groupId = 'g1';
    const plan = planKanbanDrop(doc, {
      ids: ['a', 'b'],
      dx: 100, // straight over c2
      dy: 0,
      primaryId: 'a',
    });
    expect(plan.command).toEqual({ type: 'node.move', ids: ['a', 'b'], dx: 100, dy: 0 });
  });

  it('a multi-card drop inserts both cards in y-order; no preview snap', () => {
    const doc = board([{ id: 'a', col: undefined, y: 300 }, { id: 'b', col: undefined, y: 100 }]);
    const plan = planKanbanDrop(doc, {
      ids: ['a', 'b'],
      dx: 16,
      dy: -60, // both centres land inside c1
      primaryId: 'a',
    });
    expect(plan.preview).toBeNull();
    const next = applyPatch(doc, compileCommand(doc, plan.command));
    // b (higher up) takes slot 0, a slot 1.
    expect(next.nodes.b!.y).toBe(SLOT0.y);
    expect(next.nodes.a!.y).toBe(SLOT1.y);
    expect(next.nodes.a!.groupId).toBe('c1');
    expect(next.nodes.b!.groupId).toBe('c1');
  });

  it('dropping a card back onto its exact slot is a no-op (empty patch)', () => {
    const doc = board([{ id: 'a', col: 'c1' }]); // already at slot 0
    const plan = planKanbanDrop(doc, {
      ids: ['a'],
      dx: 0,
      dy: 0, // centre stays inside c1 at its own slot
      primaryId: 'a',
    });
    expect(isEmptyPatch(compileCommand(doc, plan.command))).toBe(true);
    // The preview is the identity too (slot − position = 0,0).
    expect(plan.preview).toEqual({ dx: 0, dy: 0 });
  });

  it('a complex cross-column drop: do → undo gives the exact original document', () => {
    const doc = board([
      { id: 'a', col: 'c1' },
      { id: 'b', col: 'c1', y: SLOT1.y },
      { id: 'c', col: 'c2' },
    ]);
    const snapshot = structuredClone(doc);
    const plan = planKanbanDrop(doc, {
      ids: ['b'],
      dx: 340,
      dy: 200, // into c2, below c
      primaryId: 'b',
    });
    const patch = compileCommand(doc, plan.command);
    const next = applyPatch(doc, patch);
    expect(validateDoc(next)).toEqual([]);
    const undone = applyPatch(next, invertPatch(patch));
    expect(deepEqual(undone, snapshot)).toBe(true);
  });
});

describe('planKanbanCreate — double-click inside a column', () => {
  it('creates the card seated in its slot with membership, one batch', () => {
    const doc = board([{ id: 'a', col: 'c1' }]); // a at slot 0
    const command = planKanbanCreate(doc, { x: 100, y: 300 }, 'new'); // below a → slot 1
    expect(command).not.toBeNull();
    const next = applyPatch(doc, compileCommand(doc, command!));
    expect(next.nodes.new!.x).toBe(SLOT0.x);
    expect(next.nodes.new!.y).toBe(SLOT1.y);
    expect(next.nodes.new!.groupId).toBe('c1');
    expect(next.nodes.new!.text).toBe('New card');
    expect(validateDoc(next)).toEqual([]);
  });

  it('a click above the existing card inserts at slot 0 and shifts it', () => {
    const doc = board([{ id: 'a', col: 'c1' }]);
    const command = planKanbanCreate(doc, { x: 100, y: 60 }, 'new'); // above a's centre
    const next = applyPatch(doc, compileCommand(doc, command!));
    expect(next.nodes.new!.y).toBe(SLOT0.y);
    expect(next.nodes.a!.y).toBe(SLOT1.y);
  });

  it('returns null outside every column (the caller keeps D-28 behaviour)', () => {
    const doc = board();
    expect(planKanbanCreate(doc, { x: 250, y: 10 }, 'new')).toBeNull(); // the gap
    expect(planKanbanCreate(doc, { x: 1000, y: 1000 }, 'new')).toBeNull();
  });
});

describe('planKanbanBoard — To Do / Doing / Done', () => {
  it('centres a fresh board on the anchor; one batch of three group.creates', () => {
    const empty = emptyDoc();
    const command = planKanbanBoard(empty, { x: 0, y: 0 }, ['x1', 'x2', 'x3']);
    expect(command.type).toBe('batch');
    const next = applyPatch(empty, compileCommand(empty, command));
    expect(Object.keys(next.groups)).toEqual(['x1', 'x2', 'x3']);
    const boardW = 3 * 240 + 2 * 40;
    expect(next.groups.x1).toMatchObject({ name: 'To Do', x: -boardW / 2, y: -200 });
    expect(next.groups.x2).toMatchObject({ name: 'Doing', x: -boardW / 2 + 280 });
    expect(next.groups.x3).toMatchObject({ name: 'Done', x: -boardW / 2 + 560 });
    expect(columnsOf(next).map((g) => g.name)).toEqual([...KANBAN_BOARD_COLUMNS]);
    expect(validateDoc(next)).toEqual([]);
  });

  it('with columns already present the new board continues to their right', () => {
    const doc = board(); // c1 at x 0–240, c2 at 300–540
    const command = planKanbanBoard(doc, { x: 0, y: 0 }, ['x1', 'x2', 'x3']);
    const next = applyPatch(doc, compileCommand(doc, command));
    expect(next.groups.x1).toMatchObject({ x: 540 + 40, y: 0 }); // right of c2
    expect(next.groups.x3).toMatchObject({ x: 540 + 40 + 2 * 280, y: 0 });
  });

  it('throws without three ids (programming-error guard)', () => {
    expect(() => planKanbanBoard(emptyDoc(), { x: 0, y: 0 }, ['x1'])).toThrow();
  });
});
