/**
 * Seeded property tests (T-006 R9, T-009 R5, PLAN §7).
 *
 * For at least 200 seeded runs: generate a random initial doc (edges with
 * no duplicate pairs), then 1–25 random valid commands — node and edge —
 * with about 10% of steps being deliberately invalid edge commands that
 * must throw `CommandError` and leave the store unchanged. After every
 * valid command, assert:
 *   - `validateDoc` returns `[]`
 *   - `applyPatch(next, invertPatch(patch))` deep-equals the previous doc
 * At the end: applying all inverses in reverse restores the initial doc,
 * and re-applying all patches in order reproduces the final doc.
 */

import { describe, expect, it } from 'vitest';

import type { Anchor, Command, Doc, Edge, Node, Patch } from './types';
import { emptyDoc, validateDoc } from './doc';
import { deepEqual } from './deepEqual';
import { applyPatch, invertPatch } from './patch';
import { CommandError } from './commands';
import { createDocStore } from './store';
import { mulberry32, randInt, randPick, randSubset } from './prng.helper';

const SEED = 0x7e571234;
const RUNS = 200;

const KINDS: Node['kind'][] = ['text', 'sticky', 'card', 'image'];
const ANCHORS: Anchor[] = ['auto', 'top', 'right', 'bottom', 'left'];

function makeNode(rng: () => number, id: string): Node {
  return {
    id,
    kind: KINDS[Math.floor(rng() * KINDS.length)]!,
    x: Math.round((rng() * 2 - 1) * 1000),
    y: Math.round((rng() * 2 - 1) * 1000),
    w: 1 + Math.floor(rng() * 200),
    h: 1 + Math.floor(rng() * 200),
    text: '',
    color: '#fff',
    tags: [],
  };
}

function makeEdge(
  rng: () => number,
  id: string,
  nodeIds: string[],
): Edge | null {
  if (nodeIds.length < 2) return null;
  // Pick two distinct nodes.
  const a = randInt(rng, 0, nodeIds.length - 1);
  let b = randInt(rng, 0, nodeIds.length - 1);
  while (b === a) b = randInt(rng, 0, nodeIds.length - 1);
  return {
    id,
    from: { node: nodeIds[a]!, anchor: 'auto' },
    to: { node: nodeIds[b]!, anchor: 'auto' },
  };
}

function randomDoc(rng: () => number): Doc {
  const doc = emptyDoc();
  const nodeCount = randInt(rng, 0, 8);
  for (let i = 0; i < nodeCount; i++) {
    const id = `n${i}`;
    doc.nodes[id] = makeNode(rng, id);
    doc.order.push(id);
  }
  const nodeIds = Object.keys(doc.nodes);
  const edgeCount = randInt(rng, 0, 10);
  // D-30: no two edges share the same (from, to) pair — the random initial
  // doc must be valid under validateDoc, which now rejects duplicates.
  const seenPairs = new Set<string>();
  for (let i = 0; i < edgeCount; i++) {
    const e = makeEdge(rng, `e${i}`, nodeIds);
    if (!e) continue;
    const pairKey = JSON.stringify([e.from.node, e.to.node]);
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    doc.edges[e.id] = e;
  }
  return doc;
}

function randomCommand(
  rng: () => number,
  doc: Doc,
  counter: { nextId: number },
): Command | null {
  const nodeIds = Object.keys(doc.nodes);
  const edgeIds = Object.keys(doc.edges);
  const choice = randInt(rng, 0, 6);
  if (choice === 0) {
    // node.create with a fresh id
    const id = `new${counter.nextId++}`;
    return { type: 'node.create', node: makeNode(rng, id) };
  } else if (choice === 1 && nodeIds.length > 0) {
    // node.move a random non-empty subset by fractional/negative deltas
    const subset = randSubset(rng, nodeIds);
    return {
      type: 'node.move',
      ids: subset,
      dx: (rng() * 2 - 1) * 50.5,
      dy: (rng() * 2 - 1) * 50.5,
    };
  } else if (choice === 2 && nodeIds.length > 0) {
    // node.delete a random non-empty subset
    const subset = randSubset(rng, nodeIds);
    return { type: 'node.delete', ids: subset };
  } else if (choice === 3) {
    // edge.create: two distinct nodes, no same-direction edge yet,
    // random anchors, optional label (T-009 R5)
    return randomEdgeCreate(rng, doc, counter);
  } else if (choice === 4 && edgeIds.length > 0) {
    // edge.delete a random non-empty subset of edge ids (T-009 R5)
    const subset = randSubset(rng, edgeIds);
    return { type: 'edge.delete', ids: subset };
  } else if (choice === 5 && nodeIds.length > 0) {
    // node.update: a random content patch over a random subset (T-019)
    const subset = randSubset(rng, nodeIds);
    return {
      type: 'node.update',
      ids: subset,
      patch: {
        text: `text-${randInt(rng, 0, 100)}`,
        color: `#${randInt(rng, 0, 0xffffff).toString(16).padStart(6, '0')}`,
        tags: Array.from({ length: randInt(rng, 0, 3) }, (_, i) => `tag-${i}`),
      },
    };
  } else if (choice === 6 && nodeIds.length > 0) {
    // node.resize: random valid geometry for one node (T-019)
    const id = nodeIds[randInt(rng, 0, nodeIds.length - 1)]!;
    return {
      type: 'node.resize',
      id,
      x: (rng() * 2 - 1) * 500,
      y: (rng() * 2 - 1) * 500,
      w: randInt(rng, 1, 400),
      h: randInt(rng, 1, 400),
    };
  }
  return null;
}

/**
 * A valid `edge.create` command: two distinct existing nodes, no existing
 * same-direction edge between them, random anchors and an optional label
 * (T-009 R5). Returns null when no valid pair is left.
 */
function randomEdgeCreate(
  rng: () => number,
  doc: Doc,
  counter: { nextId: number },
): Command | null {
  const nodeIds = Object.keys(doc.nodes);
  if (nodeIds.length < 2) return null;
  const existing = new Set(
    Object.values(doc.edges).map((e) =>
      JSON.stringify([e.from.node, e.to.node]),
    ),
  );
  const candidates: Array<[string, string]> = [];
  for (const a of nodeIds) {
    for (const b of nodeIds) {
      if (a !== b && !existing.has(JSON.stringify([a, b]))) {
        candidates.push([a, b]);
      }
    }
  }
  if (candidates.length === 0) return null;
  const [from, to] = randPick(rng, candidates);
  const label = rng() < 0.5 ? `L${randInt(rng, 0, 99)}` : undefined;
  return {
    type: 'edge.create',
    edge: {
      id: `newe${counter.nextId++}`,
      from: { node: from, anchor: randPick(rng, ANCHORS) },
      to: { node: to, anchor: randPick(rng, ANCHORS) },
      ...(label !== undefined ? { label } : {}),
    },
  };
}

/**
 * A deliberately invalid `edge.create` command (T-009 R5): self-edge,
 * duplicate (from, to) pair, missing node or bad anchor. Returns null when
 * the current doc allows none of these (rare — the missing-node kind
 * always applies).
 */
function invalidEdgeCommand(
  rng: () => number,
  doc: Doc,
  counter: { nextId: number },
): Command | null {
  const nodeIds = Object.keys(doc.nodes);
  const edges = Object.values(doc.edges);
  const kinds: Array<() => Command | null> = [
    // Self-edge (needs at least one node).
    () =>
      nodeIds.length > 0
        ? {
            type: 'edge.create',
            edge: {
              id: `bade${counter.nextId++}`,
              from: { node: nodeIds[0]!, anchor: 'auto' },
              to: { node: nodeIds[0]!, anchor: 'auto' },
            },
          }
        : null,
    // Duplicate (from, to) pair (needs at least one existing edge).
    () => {
      if (edges.length === 0) return null;
      const existing = randPick(rng, edges);
      return {
        type: 'edge.create',
        edge: {
          id: `bade${counter.nextId++}`,
          from: { node: existing.from.node, anchor: 'auto' },
          to: { node: existing.to.node, anchor: 'auto' },
        },
      };
    },
    // Missing node.
    () => ({
      type: 'edge.create',
      edge: {
        id: `bade${counter.nextId++}`,
        from: { node: 'ghost-node', anchor: 'auto' },
        to: { node: 'ghost-node-2', anchor: 'auto' },
      },
    }),
    // Bad anchor (needs two distinct nodes).
    () =>
      nodeIds.length >= 2
        ? {
            type: 'edge.create',
            edge: {
              id: `bade${counter.nextId++}`,
              from: { node: nodeIds[0]!, anchor: 'diagonal' as Anchor },
              to: { node: nodeIds[1]!, anchor: 'auto' },
            },
          }
        : null,
  ];
  // Try the kinds starting from a random offset until one applies.
  const start = randInt(rng, 0, kinds.length - 1);
  for (let i = 0; i < kinds.length; i++) {
    const cmd = kinds[(start + i) % kinds.length]!();
    if (cmd !== null) return cmd;
  }
  return null;
}

describe('property tests — invariants and undo/redo round trip (R9)', () => {
  it('after every command: validateDoc([]) and invert restores prev', () => {
    let totalInvalidSteps = 0;

    for (let run = 0; run < RUNS; run++) {
      const rng = mulberry32(SEED + run);
      let doc = randomDoc(rng);
      // Sanity: the random doc must be valid (edges have no duplicate pairs).
      expect(validateDoc(doc)).toEqual([]);

      const store = createDocStore(doc, { now: () => Date.now() });
      const counter = { nextId: 0 };
      const steps = randInt(rng, 1, 25);
      const patches: Patch[] = [];
      const docs: Doc[] = [doc];

      for (let s = 0; s < steps; s++) {
        // About 10% of steps are deliberately invalid edge commands
        // (T-009 R5): they must throw CommandError and change nothing.
        if (rng() < 0.1) {
          const bad = invalidEdgeCommand(rng, doc, counter);
          if (bad !== null) {
            const snapshot = JSON.parse(JSON.stringify(doc)) as Doc;
            const revBefore = store.getRevision();
            expect(() => store.dispatch(bad)).toThrow(CommandError);
            expect(deepEqual(store.get(), snapshot)).toBe(true);
            expect(store.getRevision()).toBe(revBefore);
            totalInvalidSteps++;
            continue;
          }
        }

        const cmd = randomCommand(rng, doc, counter);
        if (!cmd) continue;

        const patch = store.dispatch(cmd);
        const next = store.get();

        // Invariant 1: the new doc is valid.
        expect(validateDoc(next)).toEqual([]);

        // Invariant 2: applying the inverse restores the previous doc.
        const restored = applyPatch(next, invertPatch(patch));
        expect(deepEqual(restored, doc)).toBe(true);

        // Per-command invariants (T-009 R5).
        if (cmd.type === 'node.move') {
          // I-01: moving nodes never touches the edges map (same reference).
          expect(next.edges).toBe(doc.edges);
        }
        if (cmd.type === 'node.delete') {
          // I-09: every removed edge was incident to a deleted node…
          const deleted = new Set(cmd.ids);
          for (const change of Object.values(patch.edges)) {
            const before = change.before!;
            expect(
              deleted.has(before.from.node) || deleted.has(before.to.node),
            ).toBe(true);
          }
          // …and no remaining edge references a deleted node.
          for (const edge of Object.values(next.edges)) {
            expect(deleted.has(edge.from.node)).toBe(false);
            expect(deleted.has(edge.to.node)).toBe(false);
          }
        }
        if (cmd.type === 'edge.create' || cmd.type === 'edge.delete') {
          // Edge commands leave nodes, groups and order untouched (R2).
          expect(next.nodes).toBe(doc.nodes);
          expect(next.groups).toBe(doc.groups);
          expect(next.order).toBe(doc.order);
        }

        doc = next;
        patches.push(patch);
        docs.push(doc);
      }

      // Undo all in reverse restores the initial document exactly.
      let undone = doc;
      for (let i = patches.length - 1; i >= 0; i--) {
        undone = applyPatch(undone, invertPatch(patches[i]!));
      }
      expect(deepEqual(undone, docs[0]!)).toBe(true);

      // Redo all in order reproduces the final document exactly.
      let redone = docs[0]!;
      for (const p of patches) {
        redone = applyPatch(redone, p);
      }
      expect(deepEqual(redone, doc)).toBe(true);
    }

    // The invalid-command path must actually have been exercised.
    expect(totalInvalidSteps).toBeGreaterThan(0);
  });
});
