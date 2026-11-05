/**
 * Kanban layout (T-035, M9) — pure, DOM-free (PLAN D-06, D-23).
 *
 * A kanban column is a group with `role: 'kanban'` and FIXED stored geometry
 * ("columns as frames with a layout role", PLAN M9) — a behaviour attached
 * to the DATA (D-14), not to a mode: any card dropped over a column snaps,
 * in any mode, exactly like a flowchart shape renders (T-032 precedent).
 *
 * This module owns every kanban constant and all slot math:
 * - where a column's cards stack (left-aligned, top → bottom, a fixed gap
 *   between one card's bottom and the next card's top — heights vary);
 * - the insertion index for a drop (the number of existing cards whose
 *   centre is above the dropped card's centre);
 * - the drop plan: ONE `batch` command (per-card `node.move`s + ONE
 *   `node.setGroup`) = one undo step (I-04: the pointer-up commits once);
 * - the create plan: a double-click inside a column creates the card
 *   already seated in its slot, membership set, one batch;
 * - the board plan: three columns (To Do / Doing / Done) in one batch.
 *
 * Planning never mutates the document; the caller dispatches the command.
 */

import { rectContains } from './geometry';
import type { Point, Rect } from './geometry';
import { newNode } from './nodeDefaults';
import type { Command, Doc, Group, Id, Node } from './types';

// ── Constants (world units unless the name says screen px) ─────────────────

/** Default column width. */
export const KANBAN_COLUMN_W = 240;
/** Default column height. */
export const KANBAN_COLUMN_H = 400;
/** Horizontal gap between the columns of one board. */
export const KANBAN_COLUMN_GAP = 40;
/** Height of the column's header strip (name + close affordance). */
export const KANBAN_HEADER_H = 36;
/** Inner padding: card x inset, and gap between header and the first card. */
export const KANBAN_PADDING = 16;
/** Vertical gap between one card's bottom and the next card's top. */
export const KANBAN_CARD_GAP = 12;
/** Screen-px hit radius of the column's × close affordance (T-021 style). */
export const KANBAN_CLOSE_HIT_RADIUS = 10;

/** The default board's column names, left → right. */
export const KANBAN_BOARD_COLUMNS = ['To Do', 'Doing', 'Done'] as const;

// ── Column helpers ──────────────────────────────────────────────────────────

/** True when `group` is a kanban column (a frame with a layout role). */
export function isColumn(group: Group): boolean {
  return group.role === 'kanban';
}

/**
 * The column's stored rect, or null when the group is not a column or its
 * geometry is missing (defensive — `validateDoc` guarantees geometry for
 * every column in a valid document).
 */
export function columnRect(group: Group): Rect | null {
  if (!isColumn(group)) return null;
  const { x, y, w, h } = group;
  if (x === undefined || y === undefined || w === undefined || h === undefined) {
    return null;
  }
  return { x, y, w, h };
}

/** Every column group in the document, in `doc.groups` insertion order. */
export function columnsOf(doc: Doc): Group[] {
  return Object.values(doc.groups).filter(isColumn);
}

/** The member nodes of `columnId`, in `doc.order` (bottom → top). */
export function columnMembers(doc: Doc, columnId: Id): Node[] {
  const members: Node[] = [];
  for (const id of doc.order) {
    const n = doc.nodes[id];
    if (n !== undefined && n.groupId === columnId) members.push(n);
  }
  return members;
}

/**
 * The column whose rect contains `point`, or null. Later groups win (the
 * same rule `groupFrameAt` uses) — overlapping columns resolve top-most by
 * insertion order.
 */
export function columnAt(doc: Doc, point: Point): Id | null {
  let hit: Id | null = null;
  for (const [id, group] of Object.entries(doc.groups)) {
    if (!isColumn(group)) continue;
    const rect = columnRect(group);
    if (rect !== null && rectContains(rect, point)) hit = id;
  }
  return hit;
}

/** The world point at the centre of a column's × close affordance. */
export function columnClosePoint(rect: Rect): Point {
  return { x: rect.x + rect.w - KANBAN_PADDING, y: rect.y + KANBAN_HEADER_H / 2 };
}

/**
 * The column whose × close affordance is under `point`, or null: the hit
 * test happens in SCREEN space (`world distance × zoom` against the radius)
 * so the target stays comfortably clickable at any zoom — the resize-handle
 * precedent (T-021).
 */
export function columnCloseHit(doc: Doc, point: Point, zoom: number): Id | null {
  if (!Number.isFinite(zoom) || zoom <= 0) return null;
  for (const [id, group] of Object.entries(doc.groups)) {
    if (!isColumn(group)) continue;
    const rect = columnRect(group);
    if (rect === null) continue;
    const cp = columnClosePoint(rect);
    const d = Math.hypot(point.x - cp.x, point.y - cp.y);
    if (d * zoom <= KANBAN_CLOSE_HIT_RADIUS) return id;
  }
  return null;
}

/**
 * The ids that move together when `nodeId` is pressed (the drag-union the
 * select input feeds the machine, kanban-aware): a kanban card drags ALONE
 * — the column is a container, not a move-together unit — while a regular
 * group member still drags its whole frame (T-024) and a free node drags
 * alone. Pure; [] when the node does not exist.
 */
export function dragMembersOf(doc: Doc, nodeId: Id): Id[] {
  const node = doc.nodes[nodeId];
  if (node === undefined || node.groupId === undefined) return [];
  const group = doc.groups[node.groupId];
  if (group !== undefined && isColumn(group)) return [];
  const members: Id[] = [];
  for (const id of doc.order) {
    const n = doc.nodes[id];
    if (n !== undefined && n.groupId === node.groupId) members.push(id);
  }
  return members;
}

// ── Slot layout ─────────────────────────────────────────────────────────────

/** Stack order: top → bottom by y, ties by x (deterministic for any doc). */
function stackSort(a: Node, b: Node): number {
  if (a.y !== b.y) return a.y - b.y;
  return a.x - b.x;
}

/**
 * The stacked slot positions for `cards` inside a column rect: x is the
 * left inset, y starts below the header and each card sits KANBAN_CARD_GAP
 * below the previous card's BOTTOM — card heights may vary.
 */
export function slotPositions(
  rect: Rect,
  cards: Node[],
): Map<Id, { x: number; y: number }> {
  const out = new Map<Id, { x: number; y: number }>();
  const x = rect.x + KANBAN_PADDING;
  let y = rect.y + KANBAN_HEADER_H + KANBAN_PADDING;
  for (const card of cards) {
    out.set(card.id, { x, y });
    y += card.h + KANBAN_CARD_GAP;
  }
  return out;
}

/**
 * The insertion index for a card whose centre sits at `centerY`: the number
 * of `others` (the column's cards, excluding the dragged ones) whose centre
 * is at or above it. Ties put the dropped card BELOW the equal one.
 */
export function insertionIndex(others: Node[], centerY: number): number {
  let index = 0;
  for (const other of others) {
    if (other.y + other.h / 2 <= centerY) index++;
  }
  return index;
}

/** Per-card `node.move`s for every card whose target differs from its
 * current position — zero-delta cards are skipped (D-22 no-ops). */
function relayoutMoves(cards: Node[], targets: Map<Id, { x: number; y: number }>): Command[] {
  const moves: Command[] = [];
  for (const card of cards) {
    const t = targets.get(card.id);
    if (t === undefined) continue;
    const dx = t.x - card.x;
    const dy = t.y - card.y;
    if (dx !== 0 || dy !== 0) {
      moves.push({ type: 'node.move', ids: [card.id], dx, dy });
    }
  }
  return moves;
}

/** The moves that close the gaps a column is left with after `draggedIds`
 * left it (the remaining members restack). [] when there is nothing to do. */
function closeGaps(doc: Doc, columnId: Id, draggedIds: Set<Id>): Command[] {
  const group = doc.groups[columnId];
  if (group === undefined || !isColumn(group)) return [];
  const rect = columnRect(group);
  if (rect === null) return [];
  const remaining = columnMembers(doc, columnId)
    .filter((n) => !draggedIds.has(n.id))
    .sort(stackSort);
  return relayoutMoves(remaining, slotPositions(rect, remaining));
}

// ── Drop planning ───────────────────────────────────────────────────────────

/** What the drag gesture knows when it plans a drop. */
export interface KanbanDropArgs {
  /** The dragged node ids (the select machine's dragIds). */
  ids: Id[];
  /** The raw world delta of the gesture (cursor world − press world). */
  dx: number;
  dy: number;
  /** The pressed node — it decides the target column and insertion index.
   * Null falls back to the first dragged id. */
  primaryId: Id | null;
}

/** A planned drop: the commit command plus the (optional) snapped preview. */
export interface KanbanDropPlan {
  /**
   * The adjusted preview delta for a SINGLE-card drag: the card renders
   * glued to its slot while the cursor is inside the column. Null keeps the
   * raw preview (free drags, multi-card drags — one uniform delta cannot
   * express per-card slots).
   */
  preview: { dx: number; dy: number } | null;
  /**
   * The pointer-up commit: either the plain `node.move` the select machine
   * emitted, or a `batch` of per-card moves + membership changes + source
   * gap-closing — always ONE command = one undo step (I-04).
   */
  command: Command;
}

/**
 * Plan the kanban effect of dropping a drag (T-035, M9). Pure: reads `doc`,
 * never mutates; the caller dispatches `plan.command` on pointer-up.
 *
 * - The PRIMARY card's preview centre picks the target column (`columnAt`)
 *   and the insertion index among its cards.
 * - Over a column: every dragged card joins it (`node.setGroup`), all its
 *   cards restack top → bottom with the dragged ones inserted, and every
 *   source column closes its gaps — one batch.
 * - Over no column: the raw `node.move`, plus membership cleared for cards
 *   that were in a column, plus source gap-closing — one batch.
 * - A drag involving a REGULAR group member never snaps: the whole frame is
 *   a move-together unit (T-024); the raw `node.move` passes through.
 */
export function planKanbanDrop(doc: Doc, args: KanbanDropArgs): KanbanDropPlan {
  const plain: Command = {
    type: 'node.move',
    ids: [...args.ids],
    dx: args.dx,
    dy: args.dy,
  };

  const dragged = args.ids
    .map((id) => doc.nodes[id])
    .filter((n): n is Node => n !== undefined);
  if (dragged.length === 0) return { preview: null, command: plain };

  // A regular-group drag never snaps.
  const inRegularGroup = dragged.some((n) => {
    if (n.groupId === undefined) return false;
    const g = doc.groups[n.groupId];
    return g !== undefined && !isColumn(g);
  });
  if (inRegularGroup) return { preview: null, command: plain };

  const primary =
    (args.primaryId !== null ? doc.nodes[args.primaryId] : undefined) ?? dragged[0]!;
  const centerX = primary.x + args.dx + primary.w / 2;
  const centerY = primary.y + args.dy + primary.h / 2;
  const targetId = columnAt(doc, { x: centerX, y: centerY });
  const draggedIds = new Set<Id>(dragged.map((n) => n.id));

  // The source columns the dragged cards are leaving (their gaps close).
  const sources = new Set<Id>();
  for (const n of dragged) {
    if (n.groupId === undefined) continue;
    const g = doc.groups[n.groupId];
    if (g !== undefined && isColumn(g) && n.groupId !== targetId) {
      sources.add(n.groupId);
    }
  }
  // The dragged cards that are column members (membership changes).
  const columnCards = dragged.filter((n) => {
    if (n.groupId === undefined) return false;
    const g = doc.groups[n.groupId];
    return g !== undefined && isColumn(g);
  });

  // Over no column: the raw move; column members leave, sources restack.
  if (targetId === null) {
    if (columnCards.length === 0) return { preview: null, command: plain };
    const commands: Command[] = [
      plain,
      { type: 'node.setGroup', ids: columnCards.map((n) => n.id), groupId: null },
    ];
    for (const source of sources) {
      commands.push(...closeGaps(doc, source, draggedIds));
    }
    return { preview: null, command: { type: 'batch', commands } };
  }

  // Over a column: insert at the drop position and restack.
  const target = doc.groups[targetId]!;
  const rect = columnRect(target);
  if (rect === null) return { preview: null, command: plain }; // defensive

  const others = columnMembers(doc, targetId)
    .filter((n) => !draggedIds.has(n.id))
    .sort(stackSort);
  const index = insertionIndex(others, centerY);
  const draggedSorted = [...dragged].sort(stackSort);
  const all = [...others.slice(0, index), ...draggedSorted, ...others.slice(index)];
  const targets = slotPositions(rect, all);

  const commands: Command[] = [...relayoutMoves(all, targets)];
  const joining = dragged.filter((n) => n.groupId !== targetId);
  if (joining.length > 0) {
    commands.push({
      type: 'node.setGroup',
      ids: joining.map((n) => n.id),
      groupId: targetId,
    });
  }
  for (const source of sources) {
    commands.push(...closeGaps(doc, source, draggedIds));
  }

  // Single-card drags preview the card glued to its slot.
  let preview: { dx: number; dy: number } | null = null;
  if (dragged.length === 1) {
    const slot = targets.get(primary.id);
    if (slot !== undefined) {
      preview = { dx: slot.x - primary.x, dy: slot.y - primary.y };
    }
  }
  return { preview, command: { type: 'batch', commands } };
}

// ── Create planning ─────────────────────────────────────────────────────────

/**
 * Plan the creation of a card at `world` (T-035): when the point is inside
 * a column, the card is created already seated in its slot (insertion index
 * by the click's y) with membership set — ONE batch = one undo step. Null
 * when the point is outside every column: the caller falls back to the
 * ordinary centred creation (D-28, unchanged).
 */
export function planKanbanCreate(doc: Doc, world: Point, id: Id): Command | null {
  const columnId = columnAt(doc, world);
  if (columnId === null) return null;
  const rect = columnRect(doc.groups[columnId]!);
  if (rect === null) return null; // defensive

  const base = newNode(id, 'card', 0, 0);
  const others = columnMembers(doc, columnId)
    .filter((n) => n.id !== id)
    .sort(stackSort);
  const index = insertionIndex(others, world.y);
  const all = [...others.slice(0, index), base, ...others.slice(index)];
  const targets = slotPositions(rect, all);

  const commands: Command[] = [...relayoutMoves(others, targets)];
  const slot = targets.get(id)!;
  commands.push({
    type: 'node.create',
    node: { ...base, x: slot.x, y: slot.y },
  });
  commands.push({ type: 'node.setGroup', ids: [id], groupId: columnId });
  return { type: 'batch', commands };
}

// ── Board planning ──────────────────────────────────────────────────────────

/**
 * Plan a fresh kanban board — To Do / Doing / Done (T-035) — as ONE batch =
 * one undo step. On an empty board the three columns are centred on
 * `anchor` (the viewport centre in world units); with columns already on
 * the board the new one continues to the RIGHT of the rightmost column,
 * top-aligned with the topmost (boards grow sideways, like lists in Trello).
 */
export function planKanbanBoard(doc: Doc, anchor: Point, ids: Id[]): Command {
  if (ids.length < KANBAN_BOARD_COLUMNS.length) {
    throw new Error(
      `planKanbanBoard: needs ${KANBAN_BOARD_COLUMNS.length} ids, got ${ids.length}`,
    );
  }
  const boardW = KANBAN_BOARD_COLUMNS.length * KANBAN_COLUMN_W +
    (KANBAN_BOARD_COLUMNS.length - 1) * KANBAN_COLUMN_GAP;
  let x0 = anchor.x - boardW / 2;
  let y0 = anchor.y - KANBAN_COLUMN_H / 2;
  const existing = columnsOf(doc)
    .map((g) => columnRect(g))
    .filter((r): r is Rect => r !== null);
  if (existing.length > 0) {
    x0 = Math.max(...existing.map((r) => r.x + r.w)) + KANBAN_COLUMN_GAP;
    y0 = Math.min(...existing.map((r) => r.y));
  }
  return {
    type: 'batch',
    commands: KANBAN_BOARD_COLUMNS.map((name, i) => ({
      type: 'group.create',
      group: {
        id: ids[i]!,
        name,
        role: 'kanban',
        x: x0 + i * (KANBAN_COLUMN_W + KANBAN_COLUMN_GAP),
        y: y0,
        w: KANBAN_COLUMN_W,
        h: KANBAN_COLUMN_H,
      },
    })),
  };
}
