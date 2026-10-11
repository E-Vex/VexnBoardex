import { describe, expect, it } from 'vitest';

import { NODE_COLORS, DEFAULT_NODE_SIZES } from '../core/nodeDefaults';
import { compileCommand } from '../core/commands';
import { emptyDoc, validateDoc } from '../core/doc';
import { applyPatch } from '../core/patch';
import type { Command, Node } from '../core/types';
import { createCardAt, shouldCreateCardAt } from './cardCommand';

/** Deterministic PRNG (mulberry32) for the centring property test. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('createCardAt — geometry (T-007 R7)', () => {
  it('world (−340, −160) gives x −440, y −220, w 200, h 120', () => {
    const cmd = createCardAt({ x: -340, y: -160 }, 'id-1');
    expect(cmd.type).toBe('node.create');
    const node = (cmd as { node: Node }).node;
    expect(node.x).toBe(-440);
    expect(node.y).toBe(-220);
    expect(node.w).toBe(200);
    expect(node.h).toBe(120);
  });

  it('the card is centred on the world point (seeded random)', () => {
    const rand = mulberry32(0xca2d);
    for (let i = 0; i < 200; i++) {
      const world = {
        x: (rand() * 2 - 1) * 1e4,
        y: (rand() * 2 - 1) * 1e4,
      };
      const node = (createCardAt(world, `n${i}`) as { node: Node }).node;
      // Centre of the node = the clicked world point.
      expect(node.x + node.w / 2).toBeCloseTo(world.x, 9);
      expect(node.y + node.h / 2).toBeCloseTo(world.y, 9);
    }
  });

  it('the defaults come from newNode: card size, text, color, tags', () => {
    const node = (createCardAt({ x: 0, y: 0 }, 'c1') as { node: Node }).node;
    expect(node.kind).toBe('card');
    expect(node.w).toBe(DEFAULT_NODE_SIZES.card.w);
    expect(node.h).toBe(DEFAULT_NODE_SIZES.card.h);
    expect(node.text).toBe('New card');
    expect(node.color).toBe(NODE_COLORS.card);
    expect(node.tags).toEqual([]);
    expect(node.groupId).toBeUndefined();
    expect(node.id).toBe('c1');
  });
});

describe('createCardAt — command validity (T-007 R7)', () => {
  it('compiles on an empty doc and the result passes validateDoc', () => {
    const doc0 = emptyDoc();
    const cmd: Command = createCardAt({ x: -340, y: -160 }, 'card-1');
    const patch = compileCommand(doc0, cmd);
    const doc1 = applyPatch(doc0, patch);
    expect(validateDoc(doc1)).toEqual([]);
    expect(doc1.order).toEqual(['card-1']);
  });

  it('compiles on a doc that already has a card elsewhere', () => {
    const doc0 = emptyDoc();
    const first = compileCommand(doc0, createCardAt({ x: 10, y: 10 }, 'c1'));
    const doc1 = applyPatch(doc0, first);
    const second = compileCommand(
      doc1,
      createCardAt({ x: 999, y: -999 }, 'c2'),
    );
    const doc2 = applyPatch(doc1, second);
    expect(validateDoc(doc2)).toEqual([]);
    expect(doc2.order).toEqual(['c1', 'c2']);
  });

  it('is pure: same inputs give deep-equal commands', () => {
    expect(createCardAt({ x: 5, y: -5 }, 'z')).toEqual(
      createCardAt({ x: 5, y: -5 }, 'z'),
    );
  });
});

// T-008 R6 / D-28 — the "may I create here?" decision.
describe('shouldCreateCardAt (D-28)', () => {
  /** A doc with one card centred on world (0, 0): rect (-100, -60)–(100, 60). */
  function docWithCard(): ReturnType<typeof emptyDoc> {
    const doc = emptyDoc();
    const patch = compileCommand(doc, createCardAt({ x: 0, y: 0 }, 'c1'));
    return applyPatch(doc, patch);
  }

  it('true on empty space (no node under the point)', () => {
    const doc = docWithCard();
    expect(shouldCreateCardAt(doc, { x: 500, y: 500 })).toBe(true);
    expect(shouldCreateCardAt(doc, { x: -1000, y: 0 })).toBe(true);
  });

  it('true anywhere in an empty doc', () => {
    expect(shouldCreateCardAt(emptyDoc(), { x: 0, y: 0 })).toBe(true);
  });

  it('false on a node interior', () => {
    const doc = docWithCard();
    expect(shouldCreateCardAt(doc, { x: 0, y: 0 })).toBe(false);
    expect(shouldCreateCardAt(doc, { x: 99, y: 59 })).toBe(false);
  });

  it('false on a node edge (edges count as inside hitTest)', () => {
    const doc = docWithCard();
    expect(shouldCreateCardAt(doc, { x: -100, y: -60 })).toBe(false);
    expect(shouldCreateCardAt(doc, { x: 100, y: 60 })).toBe(false);
  });

  it('false just outside the node', () => {
    const doc = docWithCard();
    expect(shouldCreateCardAt(doc, { x: 100.001, y: 0 })).toBe(true);
  });
});
