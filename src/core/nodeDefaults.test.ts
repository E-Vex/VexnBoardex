import { describe, expect, it } from 'vitest';

import { applyPatch } from './patch';
import { compileCommand } from './commands';
import { emptyDoc, validateDoc } from './doc';
import { NODE_COLORS, newNode } from './nodeDefaults';
import type { NodeKind } from './types';

const KINDS: NodeKind[] = ['text', 'sticky', 'card', 'image'];

describe('newNode — default sizes and top-left (T-007 R2)', () => {
  it('text is 160×40', () => {
    const n = newNode('a', 'text', 10, 20);
    expect(n.w).toBe(160);
    expect(n.h).toBe(40);
  });

  it('sticky is 160×120', () => {
    const n = newNode('a', 'sticky', 10, 20);
    expect(n.w).toBe(160);
    expect(n.h).toBe(120);
  });

  it('card is 200×120', () => {
    const n = newNode('a', 'card', 10, 20);
    expect(n.w).toBe(200);
    expect(n.h).toBe(120);
  });

  it('image is 200×150', () => {
    const n = newNode('a', 'image', 10, 20);
    expect(n.w).toBe(200);
    expect(n.h).toBe(150);
  });

  it('top-left is exactly (x, y); id and kind are echoed', () => {
    for (const kind of KINDS) {
      const n = newNode('my-id', kind, -340.5, 160.25);
      expect(n.x).toBe(-340.5);
      expect(n.y).toBe(160.25);
      expect(n.id).toBe('my-id');
      expect(n.kind).toBe(kind);
    }
  });
});

describe('newNode — text, color, tags, groupId (T-007 R2)', () => {
  it('card text is "New card"; every other kind is ""', () => {
    expect(newNode('a', 'card', 0, 0).text).toBe('New card');
    expect(newNode('a', 'text', 0, 0).text).toBe('');
    expect(newNode('a', 'sticky', 0, 0).text).toBe('');
    expect(newNode('a', 'image', 0, 0).text).toBe('');
  });

  it('each kind gets its own light color constant', () => {
    const colors = KINDS.map((kind) => NODE_COLORS[kind]);
    const n = newNode('a', 'text', 0, 0);
    expect(n.color).toBe(NODE_COLORS.text);
    // Four distinct colours (no accidental sharing).
    expect(new Set(colors).size).toBe(4);
    // Light: the average channel is high, so dark text stays readable.
    for (const c of colors) {
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(c);
      expect(m, `${c} is a #rrggbb hex literal`).not.toBeNull();
      const [r, g, b] = m!.slice(1).map((h) => parseInt(h, 16));
      expect((r + g + b) / 3).toBeGreaterThanOrEqual(0xd0);
    }
  });

  it('tags is an empty array and groupId is absent', () => {
    for (const kind of KINDS) {
      const n = newNode('a', kind, 0, 0);
      expect(n.tags).toEqual([]);
      expect('groupId' in n).toBe(false);
      expect(n.groupId).toBeUndefined();
    }
  });

  it('tags is a fresh array per call (no shared reference)', () => {
    const a = newNode('a', 'text', 0, 0);
    const b = newNode('b', 'text', 0, 0);
    expect(a.tags).not.toBe(b.tags);
    a.tags.push('x');
    expect(b.tags).toEqual([]);
  });
});

describe('newNode — purity and determinism (T-007 R2)', () => {
  it('same inputs give deep-equal nodes', () => {
    for (const kind of KINDS) {
      expect(newNode('id', kind, 5, -5)).toEqual(newNode('id', kind, 5, -5));
    }
  });

  it('does not mutate its inputs or share frozen defaults', () => {
    const n = newNode('a', 'card', 1, 2);
    // Mutating the result must not affect future results.
    n.x = 999;
    n.tags.push('oops');
    const m = newNode('b', 'card', 1, 2);
    expect(m.x).toBe(1);
    expect(m.tags).toEqual([]);
  });
});

describe('newNode — every kind compiles and applies to a valid doc (T-007 R2)', () => {
  it('compileCommand → applyPatch → validateDoc returns []', () => {
    for (const kind of KINDS) {
      const doc0 = emptyDoc();
      const node = newNode(`n-${kind}`, kind, -100, 200);
      const patch = compileCommand(doc0, { type: 'node.create', node });
      const doc1 = applyPatch(doc0, patch);
      expect(validateDoc(doc1)).toEqual([]);
      expect(doc1.nodes[node.id]).toEqual(node);
      expect(doc1.order).toEqual([node.id]);
    }
  });

  it('works with fractional and negative positions', () => {
    const doc0 = emptyDoc();
    const node = newNode('frac', 'sticky', -12.75, 33.25);
    const doc1 = applyPatch(
      doc0,
      compileCommand(doc0, { type: 'node.create', node }),
    );
    expect(validateDoc(doc1)).toEqual([]);
    expect(doc1.nodes.frac!.x).toBe(-12.75);
    expect(doc1.nodes.frac!.y).toBe(33.25);
  });
});
