/**
 * Seeded property tests (T-006 R9, PLAN §7).
 *
 * For at least 200 seeded runs: generate a random initial doc, then 1–25
 * random valid commands. After every command, assert:
 *   - `validateDoc` returns `[]`
 *   - `applyPatch(next, invertPatch(patch))` deep-equals the previous doc
 * At the end: applying all inverses in reverse restores the initial doc,
 * and re-applying all patches in order reproduces the final doc.
 */

import { describe, expect, it } from 'vitest';

import type { Command, Doc, Edge, Node, Patch } from './types';
import { emptyDoc, validateDoc } from './doc';
import { deepEqual } from './deepEqual';
import { applyPatch, invertPatch } from './patch';
import { compileCommand } from './commands';
import { mulberry32, randInt, randSubset } from './prng.helper';

const SEED = 0x7e571234;
const RUNS = 200;

const KINDS: Node['kind'][] = ['text', 'sticky', 'card', 'image'];

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
  for (let i = 0; i < edgeCount; i++) {
    const e = makeEdge(rng, `e${i}`, nodeIds);
    if (e) doc.edges[e.id] = e;
  }
  return doc;
}

function randomCommand(
  rng: () => number,
  doc: Doc,
  counter: { nextId: number },
): Command | null {
  const nodeIds = Object.keys(doc.nodes);
  const choice = randInt(rng, 0, 2);
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
  }
  return null;
}

describe('property tests — invariants and undo/redo round trip (R9)', () => {
  it('after every command: validateDoc([]) and invert restores prev', () => {
    for (let run = 0; run < RUNS; run++) {
      const rng = mulberry32(SEED + run);
      let doc = randomDoc(rng);
      // Sanity: the random doc must be valid.
      expect(validateDoc(doc)).toEqual([]);

      const counter = { nextId: 0 };
      const steps = randInt(rng, 1, 25);
      const patches: Patch[] = [];
      const docs: Doc[] = [doc];

      for (let s = 0; s < steps; s++) {
        const cmd = randomCommand(rng, doc, counter);
        if (!cmd) continue;

        const patch = compileCommand(doc, cmd);
        const next = applyPatch(doc, patch);

        // Invariant 1: the new doc is valid.
        expect(validateDoc(next)).toEqual([]);

        // Invariant 2: applying the inverse restores the previous doc.
        const restored = applyPatch(next, invertPatch(patch));
        expect(deepEqual(restored, doc)).toBe(true);

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
  });
});
