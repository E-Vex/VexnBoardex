/**
 * Serialization / deserialization (T-012, PLAN D-12, D-24).
 *
 * File format:
 * {
 *   "app": "vexboard",
 *   "version": number,
 *   "doc": Doc,
 *   "view?": { x: number, y: number, zoom: number }
 * }
 *
 * Migration chain: v1 → v2 → … (each migration is a pure function).
 * The loader never silently drops data (I-08): unknown fields are preserved,
 * and every repair is reported.
 */

import type { Doc, Node, Edge, Group, Id, NodeKind, Anchor } from './types';
import { validateDoc } from './doc';

/** Current file format version. Increment when making breaking changes. */
export const FILE_VERSION = 1;

/** The top-level file envelope. */
export interface FileEnvelope {
  app: 'vexboard';
  version: number;
  doc: Doc;
  view?: { x: number; y: number; zoom: number };
  /** Preserved unknown fields for forward compatibility (I-08). */
  [key: string]: unknown;
}

/** Result of deserialization: the envelope plus any warnings. */
export interface LoadResult {
  envelope: FileEnvelope;
  warnings: string[];
}

/** Migration function signature. */
type Migration = (envelope: FileEnvelope) => FileEnvelope;

/** Migration chain: each function upgrades from version N to N+1. */
const migrations: Migration[] = [
  // v1 is the initial version — no migration needed yet.
  // Add migrations here when FILE_VERSION increments.
];

/**
 * Serialize a document (and optional view) to a JSON string (T-012).
 * The output is a valid FileEnvelope with the current FILE_VERSION.
 */
export function serializeDoc(doc: Doc, view?: { x: number; y: number; zoom: number }): string {
  const envelope: FileEnvelope = {
    app: 'vexboard',
    version: FILE_VERSION,
    doc,
    ...(view !== undefined ? { view } : {}),
  };
  return JSON.stringify(envelope);
}

/**
 * Deserialize and migrate a JSON string to the current file version (T-012).
 * Runs the migration chain, validates the final document, and returns
 * the envelope plus any warnings (I-08: never silently drops data).
 */
export function deserializeDoc(json: string): LoadResult {
  const warnings: string[] = [];

  let envelope: FileEnvelope;
  try {
    const parsed = JSON.parse(json);
    envelope = parsed as FileEnvelope;
  } catch (e) {
    throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Validate envelope structure.
  if (envelope.app !== 'vexboard') {
    warnings.push(`Unknown app "${envelope.app}", expected "vexboard"`);
  }
  if (typeof envelope.version !== 'number' || !Number.isFinite(envelope.version)) {
    warnings.push('Missing or invalid version, assuming 1');
    envelope.version = 1;
  }
  if (!envelope.doc || typeof envelope.doc !== 'object') {
    throw new Error('Missing or invalid "doc" field');
  }

  // Run migrations from the file's version up to current.
  let currentVersion = envelope.version;
  while (currentVersion < FILE_VERSION) {
    const migration = migrations[currentVersion - 1];
    if (!migration) {
      warnings.push(`No migration from v${currentVersion} to v${currentVersion + 1}`);
      break;
    }
    try {
      envelope = migration(envelope);
      currentVersion++;
    } catch (e) {
      warnings.push(`Migration v${currentVersion}→v${currentVersion + 1} failed: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
  }
  envelope.version = FILE_VERSION;

  // Validate the final document (D-24).
  const violations = validateDoc(envelope.doc);
  if (violations.length > 0) {
    warnings.push(`Document validation: ${violations.join('; ')}`);
  }

  return { envelope, warnings };
}

/**
 * Create a Doc from a plain object (for migration helpers).
 * Performs minimal normalization without full validation.
 */
export function coerceDoc(obj: unknown): Doc {
  const doc = obj as Partial<Doc> & { nodes?: Record<string, unknown>; edges?: Record<string, unknown>; groups?: Record<string, unknown>; order?: unknown[] };
  const nodes: Record<Id, Node> = {};
  const edges: Record<Id, Edge> = {};
  const groups: Record<Id, Group> = {};
  const order: Id[] = [];

  if (doc.nodes && typeof doc.nodes === 'object') {
    for (const [id, node] of Object.entries(doc.nodes)) {
      const n = node as unknown as Record<string, unknown>;
      nodes[id] = {
        id,
        kind: (n.kind as NodeKind) || 'card',
        x: typeof n.x === 'number' && Number.isFinite(n.x) ? n.x : 0,
        y: typeof n.y === 'number' && Number.isFinite(n.y) ? n.y : 0,
        w: typeof n.w === 'number' && Number.isFinite(n.w) && n.w > 0 ? n.w : 200,
        h: typeof n.h === 'number' && Number.isFinite(n.h) && n.h > 0 ? n.h : 120,
        text: typeof n.text === 'string' ? n.text : '',
        color: typeof n.color === 'string' ? n.color : '#ffffff',
        tags: Array.isArray(n.tags) ? n.tags.filter((t): t is string => typeof t === 'string') : [],
        groupId: typeof n.groupId === 'string' ? n.groupId : undefined,
        src: typeof n.src === 'string' ? n.src : undefined,
      };
    }
  }

  if (doc.edges && typeof doc.edges === 'object') {
    for (const [id, edge] of Object.entries(doc.edges)) {
      const e = edge as unknown as Record<string, unknown>;
      const from = e.from as Record<string, unknown> | undefined;
      const to = e.to as Record<string, unknown> | undefined;
      if (from && to && typeof from.node === 'string' && typeof to.node === 'string') {
        edges[id] = {
          id,
          from: {
            node: from.node,
            anchor: (from.anchor as Anchor) || 'auto',
          },
          to: {
            node: to.node,
            anchor: (to.anchor as Anchor) || 'auto',
          },
          label: typeof e.label === 'string' ? e.label : undefined,
        };
      }
    }
  }

  if (doc.groups && typeof doc.groups === 'object') {
    for (const [id, group] of Object.entries(doc.groups)) {
      const g = group as unknown as Record<string, unknown>;
      if (typeof g.name === 'string') {
        groups[id] = { id, name: g.name };
      }
    }
  }

  if (Array.isArray(doc.order)) {
    for (const id of doc.order) {
      if (typeof id === 'string' && nodes[id]) {
        order.push(id);
      }
    }
  }

  // Ensure order is a permutation of node ids (defensive).
  const nodeIds = Object.keys(nodes);
  const orderSet = new Set(order);
  for (const id of nodeIds) {
    if (!orderSet.has(id)) order.push(id);
  }
  // Remove any order entries that don't have nodes.
  const finalOrder = order.filter((id) => nodes[id]);

  return { nodes, edges, groups, order: finalOrder };
}