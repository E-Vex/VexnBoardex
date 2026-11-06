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
  KANBAN_CHEVRON_SLOT,
  KANBAN_COLLAPSED_W,
  KANBAN_HEADER_H,
  KANBAN_MIN_COLUMN_W,
  KANBAN_MIN_COLUMN_H,
  KANBAN_PADDING,
  columnAt,
  columnCollapseHit,
  columnCollapsePoint,
  columnCloseHit,
  columnClosePoint,
  columnContentHeight,
  columnEffectiveRect,
  columnEffectiveRectOf,
  columnHeaderHit,
  columnMembers,
  columnRailRect,
  columnRect,
  columnResizeHit,
  columnResizeRect,
  columnsOf,
  dragMembersOf,
  edgeHiddenByCollapse,
  hiddenByCollapse,
  insertionIndex,
  isCollapsed,
  isColumn,
  planColumnMove,
  planColumnResize,
  planKanbanBoard,
  planKanbanCreate,
  planKanbanDrop,
  slotPositions,
} from './kanban';
import { groupFrameRect } from './hitTest';

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
    expect(plan.preview).toEqual({
      dx: SLOT0.x - doc.nodes.free!.x,
      dy: SLOT0.y - doc.nodes.free!.y,
    });
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
    expect(plan.command).toEqual({
      type: 'node.move',
      ids: ['free'],
      dx: 30,
      dy: 40,
    });
    expect(plan.preview).toBeNull();
  });

  it('a drag involving a regular group member never snaps (T-024 wins)', () => {
    const doc = board([
      { id: 'a', col: undefined },
      { id: 'b', col: undefined },
    ]);
    doc.groups = { ...doc.groups, g1: { id: 'g1', name: 'frame' } };
    doc.nodes.a!.groupId = 'g1';
    doc.nodes.b!.groupId = 'g1';
    const plan = planKanbanDrop(doc, {
      ids: ['a', 'b'],
      dx: 100, // straight over c2
      dy: 0,
      primaryId: 'a',
    });
    expect(plan.command).toEqual({
      type: 'node.move',
      ids: ['a', 'b'],
      dx: 100,
      dy: 0,
    });
  });

  it('a multi-card drop inserts both cards in y-order; no preview snap', () => {
    const doc = board([
      { id: 'a', col: undefined, y: 300 },
      { id: 'b', col: undefined, y: 100 },
    ]);
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
    expect(next.groups.x1).toMatchObject({
      name: 'To Do',
      x: -boardW / 2,
      y: -200,
    });
    expect(next.groups.x2).toMatchObject({
      name: 'Doing',
      x: -boardW / 2 + 280,
    });
    expect(next.groups.x3).toMatchObject({
      name: 'Done',
      x: -boardW / 2 + 560,
    });
    expect(columnsOf(next).map((g) => g.name)).toEqual([
      ...KANBAN_BOARD_COLUMNS,
    ]);
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

describe('kanban — auto-grow (T-037: the effective column rect)', () => {
  it('columnContentHeight: 0 for no cards; header + padding + cards + gaps otherwise', () => {
    expect(columnContentHeight([])).toBe(0);
    // One 120-high card: 36 + 16 + 120 + 16 = 188.
    expect(columnContentHeight([node('a', { h: 120 })])).toBe(
      KANBAN_HEADER_H + KANBAN_PADDING + 120 + KANBAN_PADDING,
    );
    // Three 120-high cards: one header, two gaps, both paddings.
    expect(
      columnContentHeight([
        node('a', { h: 120 }),
        node('b', { h: 120 }),
        node('c', { h: 120 }),
      ]),
    ).toBe(
      KANBAN_HEADER_H +
        KANBAN_PADDING +
        3 * 120 +
        2 * KANBAN_CARD_GAP +
        KANBAN_PADDING,
    );
  });

  it('columnEffectiveRectOf: stored height is a floor, growth extends downward', () => {
    const col = column('c1');
    const one = [node('a', { h: 120 })]; // needs 188 < 400
    const three = [
      node('a', { h: 120 }),
      node('b', { h: 120 }),
      node('c', { h: 120 }),
    ]; // 452 > 400
    expect(columnEffectiveRectOf(col, [])).toEqual({
      x: 0,
      y: 0,
      w: 240,
      h: 400,
    });
    expect(columnEffectiveRectOf(col, one)).toEqual({
      x: 0,
      y: 0,
      w: 240,
      h: 400,
    });
    expect(columnEffectiveRectOf(col, three)).toEqual({
      x: 0,
      y: 0,
      w: 240,
      h: 452,
    });
    expect(columnEffectiveRectOf({ id: 'g', name: 'f' }, [])).toBeNull();
  });

  it('columnEffectiveRect resolves by id against the document', () => {
    const doc = board([{ id: 'a', col: 'c1' }]);
    expect(columnEffectiveRect(doc, 'c1')).toEqual({
      x: 0,
      y: 0,
      w: 240,
      h: 400,
    });
    expect(columnEffectiveRect(doc, 'nope')).toBeNull();
  });

  it('columnAt targets the GROWN area below the stored height', () => {
    const doc = board([
      { id: 'a', col: 'c1' },
      { id: 'b', col: 'c1', y: SLOT1.y },
      { id: 'c', col: 'c1', y: SLOT1.y + 132 },
    ]);
    // Three cards → content 452; a point at y 430 is inside the grown column.
    expect(columnAt(doc, { x: 100, y: 430 })).toBe('c1');
    // Past the grown bottom it is not.
    expect(columnAt(doc, { x: 100, y: 470 })).toBeNull();
  });

  it('the grown frame is what groupFrameRect/PNG bounds see (hitTest route)', () => {
    // From hitTest (same layer): the one rect function used by frame clicks
    // and PNG export carries the growth.
    const doc = board([
      { id: 'a', col: 'c1' },
      { id: 'b', col: 'c1', y: SLOT1.y },
      { id: 'c', col: 'c1', y: SLOT1.y + 132 },
    ]);
    expect(groupFrameRect(doc, 'c1')).toEqual({ x: 0, y: 0, w: 240, h: 452 });
  });
});

describe('kanban — column affordance hit-tests (T-037)', () => {
  it('columnHeaderHit: the header strip only; later groups win', () => {
    const doc = board();
    expect(columnHeaderHit(doc, { x: 100, y: 18 })).toBe('c1'); // middle of the header
    expect(columnHeaderHit(doc, { x: 310, y: 0 })).toBe('c2'); // top edge counts
    expect(columnHeaderHit(doc, { x: 100, y: 40 })).toBeNull(); // below the header
    expect(columnHeaderHit(doc, { x: 250, y: 18 })).toBeNull(); // the gap
    // An overlapping later column wins the header hit.
    doc.groups = { ...doc.groups, c3: column('c3', 100, 0, 'Over') };
    expect(columnHeaderHit(doc, { x: 110, y: 18 })).toBe('c3');
  });

  it('columnResizeHit: right/bottom/corner in screen space at any zoom', () => {
    const doc = board();
    const right = { x: 240, y: 200 }; // right-edge midpoint of c1
    const bottom = { x: 120, y: 400 }; // bottom-edge midpoint
    const corner = { x: 240, y: 400 };
    expect(columnResizeHit(doc, right, 1)).toEqual({ id: 'c1', edge: 'right' });
    expect(columnResizeHit(doc, bottom, 1)).toEqual({
      id: 'c1',
      edge: 'bottom',
    });
    // The corner wins when all three radii could match.
    expect(columnResizeHit(doc, corner, 1)).toEqual({
      id: 'c1',
      edge: 'corner',
    });
    // 5 world units away at zoom 2 is 10 screen px — outside the 8px radius.
    expect(columnResizeHit(doc, { x: 245, y: 200 }, 2)).toBeNull();
    // 3 world units away at zoom 2 is 6 screen px — inside.
    expect(columnResizeHit(doc, { x: 243, y: 200 }, 2)).toEqual({
      id: 'c1',
      edge: 'right',
    });
    expect(columnResizeHit(doc, { x: 0, y: 0 }, 1)).toBeNull();
  });

  it('columnResizeRect: top-left anchored, dimensions clamped to the minimum', () => {
    const orig = { x: 0, y: 0, w: 240, h: 400 };
    expect(columnResizeRect(orig, 'right', { x: 320, y: 999 })).toEqual({
      x: 0,
      y: 0,
      w: 320,
      h: 400,
    });
    expect(columnResizeRect(orig, 'bottom', { x: 999, y: 500 })).toEqual({
      x: 0,
      y: 0,
      w: 240,
      h: 500,
    });
    expect(columnResizeRect(orig, 'corner', { x: 320, y: 500 })).toEqual({
      x: 0,
      y: 0,
      w: 320,
      h: 500,
    });
    // Dragging past the anchor clamps at the minimum, never flips.
    expect(columnResizeRect(orig, 'corner', { x: -50, y: -50 })).toEqual({
      x: 0,
      y: 0,
      w: KANBAN_MIN_COLUMN_W,
      h: KANBAN_MIN_COLUMN_H,
    });
  });
});

describe('planColumnMove — drag the whole column (T-037)', () => {
  it('moves the geometry AND every member card in ONE batch', () => {
    const doc = board([
      { id: 'a', col: 'c1' },
      { id: 'b', col: 'c1', y: SLOT1.y },
    ]);
    const plan = planColumnMove(doc, 'c1', 100, 50);
    const next = applyPatch(doc, compileCommand(doc, plan));
    expect(next.groups.c1).toMatchObject({ x: 100, y: 50, w: 240, h: 400 });
    expect(next.nodes.a).toMatchObject({ x: 116, y: 102 });
    expect(next.nodes.b).toMatchObject({ x: 116, y: 102 + 132 });
    expect(validateDoc(next)).toEqual([]);
    // ONE undo restores the whole move.
    const undone = applyPatch(next, invertPatch(compileCommand(doc, plan)));
    expect(deepEqual(undone, doc)).toBe(true);
  });

  it('an empty column moves alone; a zero delta is a no-op', () => {
    const plan = planColumnMove(board(), 'c1', 100, 50);
    const next = applyPatch(board(), compileCommand(board(), plan));
    expect(next.nodes).toEqual({});
    expect(next.groups.c1).toMatchObject({ x: 100, y: 50 });
    expect(
      isEmptyPatch(
        compileCommand(board(), planColumnMove(board(), 'c1', 0, 0)),
      ),
    ).toBe(true);
    expect(() => planColumnMove(board(), 'nope', 1, 1)).toThrow();
  });
});

describe('planColumnResize — resize the column, re-fit the cards (T-037)', () => {
  it('sets the stored geometry and stretches every card to the inner width', () => {
    const doc = board([
      { id: 'a', col: 'c1' },
      { id: 'b', col: 'c1', y: SLOT1.y },
    ]);
    const plan = planColumnResize(doc, 'c1', { x: 0, y: 0, w: 320, h: 500 });
    const next = applyPatch(doc, compileCommand(doc, plan));
    expect(next.groups.c1).toMatchObject({ x: 0, y: 0, w: 320, h: 500 });
    // Inner width 320 − 32 = 288; x inset 16; heights and stacking untouched.
    expect(next.nodes.a).toMatchObject({ x: 16, y: 52, w: 288, h: 120 });
    expect(next.nodes.b).toMatchObject({ x: 16, y: 184, w: 288 });
    expect(validateDoc(next)).toEqual([]);
    // ONE undo restores the exact original.
    const undone = applyPatch(next, invertPatch(compileCommand(doc, plan)));
    expect(deepEqual(undone, doc)).toBe(true);
  });

  it('an empty column resizes alone (just the group.update)', () => {
    const doc = board();
    const plan = planColumnResize(doc, 'c1', { x: 10, y: 20, w: 240, h: 400 });
    const next = applyPatch(doc, compileCommand(doc, plan));
    expect(next.groups.c1).toMatchObject({ x: 10, y: 20 });
    expect(next.nodes).toEqual({});
    expect(validateDoc(next)).toEqual([]);
  });

  it('guards programming errors (unknown column, no inner width)', () => {
    expect(() =>
      planColumnResize(board(), 'nope', { x: 0, y: 0, w: 240, h: 400 }),
    ).toThrow();
    expect(() =>
      planColumnResize(board(), 'c1', { x: 0, y: 0, w: 20, h: 400 }),
    ).toThrow();
  });
});

describe('planKanbanDrop/planKanbanCreate — T-037 follow-ups', () => {
  it('the plan reports its drop-target column for the highlight', () => {
    const doc = board([{ id: 'a', col: 'c1' }]);
    const over = planKanbanDrop(doc, {
      ids: ['a'],
      dx: 0,
      dy: 0,
      primaryId: 'a',
    });
    expect(over.target).toBe('c1');
    const out = planKanbanDrop(doc, {
      ids: ['a'],
      dx: 0,
      dy: 800,
      primaryId: 'a',
    });
    expect(out.target).toBeNull();
    // A regular-group drag reports no target either.
    const grouped = board([{ id: 'a', col: undefined }]);
    grouped.groups = { ...grouped.groups, g1: { id: 'g1', name: 'frame' } };
    grouped.nodes.a!.groupId = 'g1';
    expect(
      planKanbanDrop(grouped, { ids: ['a'], dx: 10, dy: 0, primaryId: 'a' })
        .target,
    ).toBeNull();
  });

  it('a card created inside a column fills it (the inner width)', () => {
    const doc = board();
    const command = planKanbanCreate(doc, { x: 100, y: 60 }, 'new');
    const next = applyPatch(doc, compileCommand(doc, command!));
    expect(next.nodes.new!.w).toBe(240 - 2 * KANBAN_PADDING);
    expect(validateDoc(next)).toEqual([]);
  });
});

describe('collapse — the rail geometry and hidden cards (T-039, M9)', () => {
  /** The same board, with c1 collapsed. */
  function collapsedBoard(
    cards: Array<{ id: string; col?: 'c1' | 'c2'; y?: number }> = [],
  ): Doc {
    const doc = board(cards);
    doc.groups.c1!.collapsed = true;
    return doc;
  }

  it('isCollapsed is column-only — a plain frame never is', () => {
    expect(isCollapsed({ ...column('c1'), collapsed: true })).toBe(true);
    expect(isCollapsed(column('c1'))).toBe(false);
    expect(isCollapsed({ ...column('c1'), collapsed: false })).toBe(false);
    expect(isCollapsed({ id: 'g', name: 'frame', collapsed: true })).toBe(
      false,
    );
  });

  it('columnRailRect keeps the top-left corner and height, swaps the width', () => {
    expect(columnRailRect({ ...column('c1'), collapsed: true })).toEqual({
      x: 0,
      y: 0,
      w: KANBAN_COLLAPSED_W,
      h: 400,
    });
    expect(columnRailRect(column('c1'))).toEqual({
      x: 0,
      y: 0,
      w: KANBAN_COLLAPSED_W,
      h: 400,
    }); // the rail is a pure geometry helper
    expect(columnRailRect({ id: 'g', name: 'frame' })).toBeNull();
  });

  it('the collapsed effective rect is the rail — no auto-grow', () => {
    const doc = collapsedBoard([
      { id: 'a', col: 'c1' },
      { id: 'b', col: 'c1', y: SLOT1.y },
      { id: 'c', col: 'c1', y: SLOT1.y + 132 },
    ]);
    const members = columnMembers(doc, 'c1');
    // Sanity: an empty column never grows past its stored height.
    expect(columnEffectiveRectOf(column('c1'), [])).toEqual({
      x: 0,
      y: 0,
      w: 240,
      h: 400,
    });
    // Expanded: three stacked cards grow the column past its stored height.
    doc.groups.c1!.collapsed = false;
    expect(columnEffectiveRectOf(doc.groups.c1!, members)!.h).toBeGreaterThan(
      400,
    );
    // Collapsed: the rail — hidden cards never grow it.
    doc.groups.c1!.collapsed = true;
    expect(columnEffectiveRectOf(doc.groups.c1!, members)).toEqual({
      x: 0,
      y: 0,
      w: KANBAN_COLLAPSED_W,
      h: 400,
    });
  });

  it('columnAt skips collapsed columns — the rail is not a drop target', () => {
    const doc = collapsedBoard([{ id: 'a', col: 'c1' }]);
    expect(columnAt(doc, { x: 10, y: 10 })).toBeNull(); // the rail, skipped
    expect(columnAt(doc, { x: 310, y: 10 })).toBe('c2'); // c2 expanded
    doc.groups.c1!.collapsed = false;
    expect(columnAt(doc, { x: 10, y: 10 })).toBe('c1');
  });

  it('the whole rail is the collapsed column’s header; expansion restores the strip', () => {
    const doc = collapsedBoard();
    // Below the header strip: a hit while collapsed, empty while expanded.
    expect(columnHeaderHit(doc, { x: 10, y: 300 })).toBe('c1');
    doc.groups.c1!.collapsed = false;
    expect(columnHeaderHit(doc, { x: 10, y: 300 })).toBeNull();
    expect(columnHeaderHit(doc, { x: 10, y: 18 })).toBe('c1'); // the strip
  });

  it('no × and no resize affordances while collapsed', () => {
    const doc = collapsedBoard();
    const cp = columnClosePoint(columnRect(doc.groups.c1!)!);
    expect(columnCloseHit(doc, cp, 1)).toBeNull();
    expect(columnResizeHit(doc, { x: 240, y: 200 }, 1)).toBeNull(); // the stored right edge
    expect(columnResizeHit(doc, { x: 240, y: 400 }, 1)).toBeNull(); // the stored corner
    doc.groups.c1!.collapsed = false;
    expect(columnCloseHit(doc, cp, 1)).toBe('c1');
    expect(columnResizeHit(doc, { x: 240, y: 200 }, 1)).toEqual({
      id: 'c1',
      edge: 'right',
    });
  });

  it('columnCollapsePoint sits in the header slot expanded, the rail centre collapsed', () => {
    expect(columnCollapsePoint(column('c1'))).toEqual({
      x: KANBAN_PADDING + KANBAN_CHEVRON_SLOT / 2,
      y: KANBAN_HEADER_H / 2,
    });
    expect(columnCollapsePoint({ ...column('c1'), collapsed: true })).toEqual({
      x: KANBAN_COLLAPSED_W / 2,
      y: KANBAN_HEADER_H / 2,
    });
    expect(columnCollapsePoint({ id: 'g', name: 'frame' })).toBeNull();
  });

  it('columnCollapseHit works in screen space at any zoom', () => {
    const doc = board();
    const expandedCp = columnCollapsePoint(column('c1'))!;
    expect(columnCollapseHit(doc, expandedCp, 1)).toBe('c1');
    // The threshold is in SCREEN pixels: 5 world units at zoom 2 is 10 px
    // (the boundary, inclusive); 9 world units is 18 px — far out.
    expect(
      columnCollapseHit(doc, { x: expandedCp.x - 5, y: expandedCp.y }, 2),
    ).toBe('c1');
    expect(
      columnCollapseHit(doc, { x: expandedCp.x - 9, y: expandedCp.y }, 2),
    ).toBeNull();
    expect(columnCollapseHit(doc, { x: 300, y: 300 }, 1)).toBeNull();
    // Collapsed: the same hit-test finds the rail chevron.
    doc.groups.c1!.collapsed = true;
    const railCp = columnCollapsePoint(doc.groups.c1!)!;
    expect(columnCollapseHit(doc, railCp, 1)).toBe('c1');
  });

  it('hiddenByCollapse / edgeHiddenByCollapse derive hiding from the data', () => {
    const doc = collapsedBoard([
      { id: 'a', col: 'c1' },
      { id: 'b', col: 'c2' },
    ]);
    doc.nodes.free = node('free', { x: 1000, y: 1000 });
    doc.order.push('free');
    expect(hiddenByCollapse(doc, doc.nodes.a!)).toBe(true);
    expect(hiddenByCollapse(doc, doc.nodes.b!)).toBe(false);
    expect(hiddenByCollapse(doc, doc.nodes.free!)).toBe(false);
    doc.groups.c1!.collapsed = false;
    expect(hiddenByCollapse(doc, doc.nodes.a!)).toBe(false);

    doc.groups.c1!.collapsed = true;
    doc.edges = {
      e1: {
        id: 'e1',
        from: { node: 'a', anchor: 'auto' },
        to: { node: 'b', anchor: 'auto' },
      },
      e2: {
        id: 'e2',
        from: { node: 'b', anchor: 'auto' },
        to: { node: 'free', anchor: 'auto' },
      },
    };
    expect(edgeHiddenByCollapse(doc, doc.edges.e1!)).toBe(true);
    expect(edgeHiddenByCollapse(doc, doc.edges.e2!)).toBe(false);
  });
});
