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
import type { Edge, Id, Node } from './types';

/** Thrown when a command cannot be compiled (PLAN D-22). */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

const VALID_KINDS = new Set(['text', 'sticky', 'card', 'image']);

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
    default:
      throw new CommandError(
        `unknown command type: ${(command as { type: string }).type}`,
      );
  }
}
