/**
 * Patch apply / invert (T-006 R4, PLAN D-09, D-22).
 *
 * `applyPatch` is strict: every entity change's `before` must `deepEqual` the
 * document's current entity (absent = `undefined`). A mismatch throws
 * `PatchConflictError`. `invertPatch` swaps before/after so undo restores
 * the previous document exactly.
 *
 * Pure: returns new objects, never mutates the input document or patch.
 * Structural sharing: maps and arrays the patch does not touch keep their
 * reference.
 */

import { deepEqual } from './deepEqual';
import type { Doc, Edge, Group, Node, Patch, EntityChange } from './types';

/** Thrown by `applyPatch` when a patch's `before` does not match the document. */
export class PatchConflictError extends Error {
  readonly kind: 'nodes' | 'edges' | 'groups' | 'order';
  readonly id: string;
  constructor(
    kind: 'nodes' | 'edges' | 'groups' | 'order',
    id: string,
    message: string,
  ) {
    super(message);
    this.name = 'PatchConflictError';
    this.kind = kind;
    this.id = id;
  }
}

/** Copies a shallow map (structural sharing for untouched maps). */
function copyMap<T>(m: Record<string, T>): Record<string, T> {
  return { ...m };
}

/**
 * Apply a patch to a document, strictly (T-006 R4).
 *
 * - For every entity change, the document's current entity must `deepEqual`
 *   `before`. Otherwise throw `PatchConflictError`.
 * - `after: undefined` deletes the entity; otherwise it is set.
 * - If `patch.order` exists, the document's `order` must `deepEqual` `before`,
 *   then becomes `after` (a copy).
 * - Returns a new `Doc`. Untouched maps/arrays keep their reference.
 * - Never mutates the input document or patch.
 * - Does not call `validateDoc`.
 */
export function applyPatch(doc: Doc, patch: Patch): Doc {
  // Validate all entity changes before applying any (all-or-nothing).
  // We also check order.before here so a conflict leaves the doc unchanged.

  // Check nodes.
  for (const [id, change] of Object.entries(patch.nodes)) {
    const current = doc.nodes[id];
    const before = change.before;
    if (!deepEqual(current, before)) {
      throw new PatchConflictError(
        'nodes',
        id,
        `nodes["${id}"]: before does not match document`,
      );
    }
  }

  // Check edges.
  for (const [id, change] of Object.entries(patch.edges)) {
    const current = doc.edges[id];
    const before = change.before;
    if (!deepEqual(current, before)) {
      throw new PatchConflictError(
        'edges',
        id,
        `edges["${id}"]: before does not match document`,
      );
    }
  }

  // Check groups.
  for (const [id, change] of Object.entries(patch.groups)) {
    const current = doc.groups[id];
    const before = change.before;
    if (!deepEqual(current, before)) {
      throw new PatchConflictError(
        'groups',
        id,
        `groups["${id}"]: before does not match document`,
      );
    }
  }

  // Check order.
  if (patch.order !== undefined) {
    if (!deepEqual(doc.order, patch.order.before)) {
      throw new PatchConflictError(
        'order',
        '',
        'order: before does not match document',
      );
    }
  }

  // All checks passed. Apply with structural sharing.
  let nodes = doc.nodes;
  let edges = doc.edges;
  let groups = doc.groups;
  let order = doc.order;

  const nodeEntries = Object.entries(patch.nodes);
  if (nodeEntries.length > 0) {
    nodes = copyMap(doc.nodes);
    for (const [id, change] of nodeEntries) {
      if (change.after === undefined) {
        delete nodes[id];
      } else {
        nodes[id] = change.after;
      }
    }
  }

  const edgeEntries = Object.entries(patch.edges);
  if (edgeEntries.length > 0) {
    edges = copyMap(doc.edges);
    for (const [id, change] of edgeEntries) {
      if (change.after === undefined) {
        delete edges[id];
      } else {
        edges[id] = change.after;
      }
    }
  }

  const groupEntries = Object.entries(patch.groups);
  if (groupEntries.length > 0) {
    groups = copyMap(doc.groups);
    for (const [id, change] of groupEntries) {
      if (change.after === undefined) {
        delete groups[id];
      } else {
        groups[id] = change.after;
      }
    }
  }

  if (patch.order !== undefined) {
    order = [...patch.order.after];
  }

  return { nodes, edges, groups, order };
}

/** Swaps `before` and `after` for a single entity change. */
function invertChange<T>(change: EntityChange<T>): EntityChange<T> {
  const result: EntityChange<T> = {};
  if (change.after !== undefined) result.before = change.after;
  if (change.before !== undefined) result.after = change.before;
  return result;
}

/**
 * Invert a patch: swap `before` and `after` for every entity change and for
 * `order` (T-006 R4). Returns a new `Patch`; does not mutate the input.
 */
export function invertPatch(patch: Patch): Patch {
  const nodes: Record<string, EntityChange<Node>> = {};
  for (const [id, change] of Object.entries(patch.nodes)) {
    nodes[id] = invertChange(change);
  }
  const edges: Record<string, EntityChange<Edge>> = {};
  for (const [id, change] of Object.entries(patch.edges)) {
    edges[id] = invertChange(change);
  }
  const groups: Record<string, EntityChange<Group>> = {};
  for (const [id, change] of Object.entries(patch.groups)) {
    groups[id] = invertChange(change);
  }
  const order =
    patch.order !== undefined
      ? { before: patch.order.after, after: patch.order.before }
      : undefined;
  return { nodes, edges, groups, order };
}

/**
 * True when a patch has no entity changes in any map and no `order` change
 * (T-006 R4).
 */
export function isEmptyPatch(patch: Patch): boolean {
  if (Object.keys(patch.nodes).length > 0) return false;
  if (Object.keys(patch.edges).length > 0) return false;
  if (Object.keys(patch.groups).length > 0) return false;
  if (patch.order !== undefined) return false;
  return true;
}
