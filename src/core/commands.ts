/**
 * Commands (T-006 R5, PLAN D-22).
 *
 * `compileCommand(doc, command) → Patch` is pure and strict: an invalid
 * command throws `CommandError`. A no-op command compiles to an empty
 * patch. IDs come from the caller (D-11).
 */

import type { Command } from './types';
import type { Doc } from './types';
import type { Patch } from './types';
import type { Anchor, Edge, Id, Node } from './types';

/** Thrown when a command cannot be compiled (PLAN D-22). */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

const VALID_KINDS = new Set(['text', 'sticky', 'card', 'image']);

/** The five valid edge anchors (D-30). Checked at runtime — commands are data. */
const VALID_ANCHORS = new Set<Anchor>([
  'auto',
  'top',
  'right',
  'bottom',
  'left',
]);

/** An empty patch (no entity changes, no order). */
function emptyPatch(): Patch {
  return { nodes: {}, edges: {}, groups: {} };
}

/** True when `value` is a string. */
function isString(v: unknown): v is string {
  return typeof v === 'string';
}

/** True when `value` is an array of strings. */
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((el) => typeof el === 'string');
}

/**
 * Compile `node.create`: the node is appended on top of `order`.
 * Throws `CommandError` on any invalid field (R5).
 */
function compileCreate(doc: Doc, node: Node): Patch {
  if (node.id === '') {
    throw new CommandError('node.create: id is empty');
  }
  if (Object.prototype.hasOwnProperty.call(doc.nodes, node.id)) {
    throw new CommandError(`node.create: id "${node.id}" already exists`);
  }
  if (!VALID_KINDS.has(node.kind)) {
    throw new CommandError(`node.create: invalid kind "${node.kind}"`);
  }
  if (!Number.isFinite(node.x)) {
    throw new CommandError('node.create: x is not finite');
  }
  if (!Number.isFinite(node.y)) {
    throw new CommandError('node.create: y is not finite');
  }
  if (!Number.isFinite(node.w) || node.w <= 0) {
    throw new CommandError('node.create: w is not finite or ≤ 0');
  }
  if (!Number.isFinite(node.h) || node.h <= 0) {
    throw new CommandError('node.create: h is not finite or ≤ 0');
  }
  if (!isString(node.text)) {
    throw new CommandError('node.create: text is not a string');
  }
  if (!isString(node.color)) {
    throw new CommandError('node.create: color is not a string');
  }
  if (!isStringArray(node.tags)) {
    throw new CommandError('node.create: tags is not an array of strings');
  }
  if (
    node.groupId !== undefined &&
    !Object.prototype.hasOwnProperty.call(doc.groups, node.groupId)
  ) {
    throw new CommandError(
      `node.create: groupId "${node.groupId}" does not exist`,
    );
  }

  return {
    nodes: { [node.id]: { after: node } },
    edges: {},
    groups: {},
    order: { before: doc.order, after: [...doc.order, node.id] },
  };
}

/**
 * Compile `node.move`: applies the delta to every id. Duplicates are
 * ignored (first occurrence wins). Unknown ids throw. Empty `ids` or
 * `dx === 0 && dy === 0` returns an empty patch (R5).
 */
function compileMove(doc: Doc, ids: Id[], dx: number, dy: number): Patch {
  if (!Number.isFinite(dx)) {
    throw new CommandError('node.move: dx is not finite');
  }
  if (!Number.isFinite(dy)) {
    throw new CommandError('node.move: dy is not finite');
  }

  // De-duplicate ids (first occurrence wins).
  const seen = new Set<Id>();
  const uniqueIds: Id[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      uniqueIds.push(id);
    }
  }

  // Validate all ids exist — unknown id throws even if dx and dy are 0.
  for (const id of uniqueIds) {
    if (!Object.prototype.hasOwnProperty.call(doc.nodes, id)) {
      throw new CommandError(`node.move: unknown id "${id}"`);
    }
  }

  // No-op: empty ids or zero delta.
  if (uniqueIds.length === 0 || (dx === 0 && dy === 0)) {
    return emptyPatch();
  }

  const nodes: Patch['nodes'] = {};
  for (const id of uniqueIds) {
    const before = doc.nodes[id]!;
    nodes[id] = {
      before,
      after: { ...before, x: before.x + dx, y: before.y + dy },
    };
  }
  return { nodes, edges: {}, groups: {} };
}

/**
 * Compile `node.delete`: removes nodes, their order entries, and every
 * incident edge — all in one patch (R5, I-09). Duplicates ignored; unknown
 * id throws; empty `ids` returns an empty patch.
 */
function compileDelete(doc: Doc, ids: Id[]): Patch {
  // De-duplicate ids (first occurrence wins).
  const seen = new Set<Id>();
  const uniqueIds: Id[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      uniqueIds.push(id);
    }
  }

  // Validate all ids exist.
  for (const id of uniqueIds) {
    if (!Object.prototype.hasOwnProperty.call(doc.nodes, id)) {
      throw new CommandError(`node.delete: unknown id "${id}"`);
    }
  }

  // No-op: empty ids.
  if (uniqueIds.length === 0) {
    return emptyPatch();
  }

  const deleteSet = new Set(uniqueIds);
  const nodes: Patch['nodes'] = {};
  for (const id of uniqueIds) {
    nodes[id] = { before: doc.nodes[id]! };
  }

  // Find every edge that references a deleted node (listed once).
  const edges: Patch['edges'] = {};
  for (const [edgeId, edge] of Object.entries(doc.edges)) {
    if (deleteSet.has(edge.from.node) || deleteSet.has(edge.to.node)) {
      edges[edgeId] = { before: edge as Edge };
    }
  }

  // Filter order: keep ids not in the delete set.
  const afterOrder = doc.order.filter((id) => !deleteSet.has(id));

  return {
    nodes,
    edges,
    groups: {},
    order: { before: doc.order, after: afterOrder },
  };
}

/**
 * Compile `edge.create`: adds the edge. Both nodes must exist, no
 * self-edge, no duplicate (from, to) pair — the reverse direction is
 * allowed — each anchor must be one of the five (checked at runtime:
 * commands are data), and an optional `label` must be a string (T-009 R2,
 * D-30). Nodes and `order` are untouched.
 */
function compileEdgeCreate(doc: Doc, edge: Edge): Patch {
  if (edge.id === '') {
    throw new CommandError('edge.create: id is empty');
  }
  if (Object.prototype.hasOwnProperty.call(doc.edges, edge.id)) {
    throw new CommandError(`edge.create: id "${edge.id}" already exists`);
  }
  if (
    !isString(edge.from?.node) ||
    !Object.prototype.hasOwnProperty.call(doc.nodes, edge.from.node)
  ) {
    throw new CommandError(
      `edge.create: from.node "${String(edge.from?.node)}" does not exist`,
    );
  }
  if (
    !isString(edge.to?.node) ||
    !Object.prototype.hasOwnProperty.call(doc.nodes, edge.to.node)
  ) {
    throw new CommandError(
      `edge.create: to.node "${String(edge.to?.node)}" does not exist`,
    );
  }
  if (edge.from.node === edge.to.node) {
    throw new CommandError(
      `edge.create: edge "${edge.id}" connects a node to itself`,
    );
  }
  for (const [id, existing] of Object.entries(doc.edges)) {
    if (
      existing.from.node === edge.from.node &&
      existing.to.node === edge.to.node
    ) {
      throw new CommandError(
        `edge.create: edge "${edge.id}" repeats the (from, to) pair of edge "${id}"`,
      );
    }
  }
  if (!VALID_ANCHORS.has(edge.from.anchor)) {
    throw new CommandError(
      `edge.create: from.anchor "${String(edge.from.anchor)}" is not one of 'auto' | 'top' | 'right' | 'bottom' | 'left'`,
    );
  }
  if (!VALID_ANCHORS.has(edge.to.anchor)) {
    throw new CommandError(
      `edge.create: to.anchor "${String(edge.to.anchor)}" is not one of 'auto' | 'top' | 'right' | 'bottom' | 'left'`,
    );
  }
  if (edge.label !== undefined && !isString(edge.label)) {
    throw new CommandError('edge.create: label is not a string');
  }

  return { nodes: {}, edges: { [edge.id]: { after: edge } }, groups: {} };
}

/**
 * Compile `edge.delete`: removes the listed edges. Duplicates are ignored;
 * an unknown id throws; empty `ids` returns an empty patch (T-009 R2).
 * Nodes and `order` are untouched.
 */
function compileEdgeDelete(doc: Doc, ids: Id[]): Patch {
  // De-duplicate ids (first occurrence wins).
  const seen = new Set<Id>();
  const uniqueIds: Id[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      uniqueIds.push(id);
    }
  }

  // Validate all ids exist.
  for (const id of uniqueIds) {
    if (!Object.prototype.hasOwnProperty.call(doc.edges, id)) {
      throw new CommandError(`edge.delete: unknown id "${id}"`);
    }
  }

  // No-op: empty ids.
  if (uniqueIds.length === 0) {
    return emptyPatch();
  }

  const edges: Patch['edges'] = {};
  for (const id of uniqueIds) {
    edges[id] = { before: doc.edges[id]! };
  }
  return { nodes: {}, edges, groups: {} };
}

/**
 * Compile a command into a patch (T-006 R5, PLAN D-22).
 *
 * Pure and strict: never mutates `doc` or `command`. Throws `CommandError`
 * for any invalid command. A no-op command compiles to an empty patch.
 */
export function compileCommand(doc: Doc, command: Command): Patch {
  switch (command.type) {
    case 'node.create':
      return compileCreate(doc, command.node);
    case 'node.move':
      return compileMove(doc, command.ids, command.dx, command.dy);
    case 'node.delete':
      return compileDelete(doc, command.ids);
    case 'edge.create':
      return compileEdgeCreate(doc, command.edge);
    case 'edge.delete':
      return compileEdgeDelete(doc, command.ids);
    default:
      throw new CommandError(
        `unknown command type: ${(command as { type: string }).type}`,
      );
  }
}
