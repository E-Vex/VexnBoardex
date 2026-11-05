/**
 * `emptyDoc` — returns a fresh empty document (T-006 R3, PLAN §4).
 *
 * Each call returns a new object so callers can freely mutate the result
 * without affecting other documents.
 */

import type { Doc, Group, Id, NodeShape, EdgeRoute, GroupRole } from './types';

/** A fresh `{ nodes: {}, edges: {}, groups: {}, order: [] }` each call. */
export function emptyDoc(): Doc {
  return {
    nodes: {},
    edges: {},
    groups: {},
    order: [],
  };
}

/** The four valid node shapes (T-032, D-24-style central definition). */
export const VALID_SHAPES: ReadonlySet<NodeShape> = new Set([
  'rect',
  'rounded',
  'diamond',
  'stadium',
]);

/** The three valid edge routes (T-033, D-24-style central definition). */
export const VALID_ROUTES: ReadonlySet<EdgeRoute> = new Set([
  'auto',
  'straight',
  'orthogonal',
]);

/** The valid group layout roles (T-035). */
export const VALID_GROUP_ROLES: ReadonlySet<GroupRole> = new Set(['kanban']);

/**
 * The violations of ONE group's data (T-035, D-24-style central definition,
 * shared with `group.create`'s strict validation, D-22):
 * - `bad-group-role:` — a `role` that is present but not `'kanban'`.
 * - `bad-group-geometry:` — a kanban column without finite x/y/w/h
 *   (w > 0, h > 0), or geometry fields on a group with NO role (a plain
 *   frame derives its rect from its members — stored geometry would be a
 *   lie, T-024).
 *
 * Pure: returns [] when the group's shape is valid.
 */
export function groupViolations(group: Group, key = group.id): string[] {
  const errors: string[] = [];
  if (group.role !== undefined && !VALID_GROUP_ROLES.has(group.role)) {
    errors.push(
      `bad-group-role: group "${key}" has invalid role ${JSON.stringify(group.role)}`,
    );
    return errors; // geometry rules assume a known role
  }
  const hasGeometry =
    group.x !== undefined ||
    group.y !== undefined ||
    group.w !== undefined ||
    group.h !== undefined;
  if (group.role === undefined) {
    if (hasGeometry) {
      errors.push(
        `bad-group-geometry: group "${key}" has geometry but no role`,
      );
    }
    return errors;
  }
  // role === 'kanban': finite geometry, w > 0, h > 0, all four present.
  const { x, y, w, h } = group;
  if (
    x === undefined ||
    y === undefined ||
    w === undefined ||
    h === undefined ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(w) ||
    !Number.isFinite(h) ||
    w <= 0 ||
    h <= 0
  ) {
    errors.push(
      `bad-group-geometry: kanban column "${key}" needs finite x/y/w/h with w > 0 and h > 0`,
    );
  }
  return errors;
}

/**
 * `validateDoc` — returns a list of violation messages, empty when the
 * document is valid (T-006 R3, PLAN D-24). Pure: never mutates.
 *
 * Each message starts with a code and a colon:
 * - `order-mismatch:` — `order` is not exactly a permutation of node ids.
 * - `key-mismatch:` — a map key differs from its entity's `id`.
 * - `edge-dangling:` — an edge references a node that does not exist.
 * - `edge-self:` — an edge's `from.node` equals its `to.node`.
 * - `edge-duplicate:` — two edges share the same (from, to) pair (D-30);
 *   the reverse direction is allowed.
 * - `group-dangling:` — a node's `groupId` references a missing group.
 * - `bad-number:` — a non-finite `x`, `y`, `w`, `h`, or `w ≤ 0`, `h ≤ 0`.
 * - `bad-src:` — a `src` that is present but not a string (T-023).
 * - `bad-shape:` — a `shape` that is present but not one of the four node
 *   shapes (T-032).
 * - `bad-route:` — an edge `route` that is present but not one of the three
 *   edge routes (T-033).
 * - `bad-group-role:` / `bad-group-geometry:` — a group whose layout role or
 *   column geometry is invalid (T-035; see `groupViolations`).
 */
export function validateDoc(doc: Doc): string[] {
  const errors: string[] = [];

  // key-mismatch: every map key equals its entity's id.
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (id !== node.id) {
      errors.push(`key-mismatch: nodes key "${id}" ≠ node.id "${node.id}"`);
    }
  }
  for (const [id, edge] of Object.entries(doc.edges)) {
    if (id !== edge.id) {
      errors.push(`key-mismatch: edges key "${id}" ≠ edge.id "${edge.id}"`);
    }
  }
  for (const [id, group] of Object.entries(doc.groups)) {
    if (id !== group.id) {
      errors.push(`key-mismatch: groups key "${id}" ≠ group.id "${group.id}"`);
    }
  }

  // bad-number: non-finite x/y/w/h or w ≤ 0 or h ≤ 0.
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!Number.isFinite(node.x)) {
      errors.push(`bad-number: node "${id}" has non-finite x`);
    }
    if (!Number.isFinite(node.y)) {
      errors.push(`bad-number: node "${id}" has non-finite y`);
    }
    if (!Number.isFinite(node.w) || node.w <= 0) {
      errors.push(`bad-number: node "${id}" has invalid w`);
    }
    if (!Number.isFinite(node.h) || node.h <= 0) {
      errors.push(`bad-number: node "${id}" has invalid h`);
    }
  }

  // order-mismatch: order is not exactly a permutation of node ids.
  const nodeIds = Object.keys(doc.nodes);
  const orderSet = new Set(doc.order);
  if (doc.order.length !== nodeIds.length) {
    errors.push(
      `order-mismatch: order length ${doc.order.length} ≠ node count ${nodeIds.length}`,
    );
  } else {
    // Same length — check it's a permutation (no missing, no extra, no dup).
    for (const id of nodeIds) {
      if (!orderSet.has(id)) {
        errors.push(`order-mismatch: node "${id}" missing from order`);
      }
    }
    // Duplicates: if the set is smaller than the array, there are dups.
    if (orderSet.size !== doc.order.length) {
      errors.push('order-mismatch: order contains duplicate ids');
    }
  }

  // edge-dangling, edge-self and edge-duplicate.
  // pairOwner maps a (from, to) pair to the first edge id that claimed it
  // (D-30: no two edges share the same pair; the reverse direction is valid).
  const pairOwner = new Map<string, Id>();
  for (const [id, edge] of Object.entries(doc.edges)) {
    if (!Object.prototype.hasOwnProperty.call(doc.nodes, edge.from.node)) {
      errors.push(
        `edge-dangling: edge "${id}" from.node "${edge.from.node}" does not exist`,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(doc.nodes, edge.to.node)) {
      errors.push(
        `edge-dangling: edge "${id}" to.node "${edge.to.node}" does not exist`,
      );
    }
    if (edge.from.node === edge.to.node) {
      errors.push(`edge-self: edge "${id}" connects a node to itself`);
    }
    const pairKey = JSON.stringify([edge.from.node, edge.to.node]);
    const owner = pairOwner.get(pairKey);
    if (owner !== undefined) {
      errors.push(
        `edge-duplicate: edge "${id}" repeats the (from, to) pair of edge "${owner}"`,
      );
    } else {
      pairOwner.set(pairKey, id);
    }
  }

  // group-dangling: a node's groupId references a missing group.
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (
      node.groupId !== undefined &&
      !Object.prototype.hasOwnProperty.call(doc.groups, node.groupId)
    ) {
      errors.push(
        `group-dangling: node "${id}" groupId "${node.groupId}" does not exist`,
      );
    }
  }

  // bad-src: an image source that is not a string (T-023).
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (node.src !== undefined && typeof node.src !== 'string') {
      errors.push(`bad-src: node "${id}" has a non-string src`);
    }
  }

  // bad-shape: a shape that is not one of the four (T-032). Absent is
  // valid — it means 'rect' — so pre-shape files never fail here.
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (node.shape !== undefined && !VALID_SHAPES.has(node.shape)) {
      errors.push(
        `bad-shape: node "${id}" has invalid shape ${JSON.stringify(node.shape)}`,
      );
    }
  }

  // bad-route: a route that is not one of the three (T-033). Absent is
  // valid — it means 'auto' — so pre-route files never fail here.
  for (const [id, edge] of Object.entries(doc.edges)) {
    if (edge.route !== undefined && !VALID_ROUTES.has(edge.route)) {
      errors.push(
        `bad-route: edge "${id}" has invalid route ${JSON.stringify(edge.route)}`,
      );
    }
  }

  // Group layout roles and column geometry (T-035). Absent role and
  // geometry — every pre-kanban group — never fails here.
  for (const [id, group] of Object.entries(doc.groups)) {
    errors.push(...groupViolations(group, id));
  }

  return errors;
}
