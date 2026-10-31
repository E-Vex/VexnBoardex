// contentBounds unit tests (M8, T-027). Pure core: no DOM (D-06).
import { describe, expect, it } from 'vitest';

import { GROUP_FRAME_PADDING } from './hitTest';
import { contentBounds } from './contentBounds';
import type { Doc, Node } from './types';

function node(id: string, x: number, y: number, w = 10, h = 10): Node {
  return {
    id,
    kind: 'card',
    x,
    y,
    w,
    h,
    text: '',
    color: '#fff',
    tags: [],
  };
}

function docOf(nodes: Node[], groups: Record<string, { id: string; name: string }> = {}): Doc {
  return {
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    edges: {},
    groups,
    order: nodes.map((n) => n.id),
  };
}

describe('contentBounds', () => {
  it('returns null for an empty document', () => {
    expect(contentBounds(docOf([]))).toBeNull();
  });

  it('returns the node rect for a single node', () => {
    const doc = docOf([node('a', 5, 7, 20, 30)]);
    expect(contentBounds(doc)).toEqual({ x: 5, y: 7, w: 20, h: 30 });
  });

  it('unions several nodes, including negative coordinates', () => {
    const doc = docOf([
      node('a', -50, -30, 10, 10),
      node('b', 100, 200, 20, 5),
      node('c', 0, 0, 5, 5),
    ]);
    // x: -50 … 120, y: -30 … 205
    expect(contentBounds(doc)).toEqual({ x: -50, y: -30, w: 170, h: 235 });
  });

  it('is the union, not the bounding hull of centres', () => {
    const doc = docOf([
      node('a', 0, 0, 100, 1),
      node('b', 90, 50, 10, 10),
    ]);
    // x: 0 … 100, y: 0 … 60
    expect(contentBounds(doc)).toEqual({ x: 0, y: 0, w: 100, h: 60 });
  });

  it('includes group frames, which pad beyond their members', () => {
    const doc = docOf([node('a', 0, 0, 40, 40)], {
      g: { id: 'g', name: 'G' },
    });
    doc.nodes['a']!.groupId = 'g';
    const bounds = contentBounds(doc);
    // Frame = members bbox ± GROUP_FRAME_PADDING (16) on every side.
    expect(bounds).toEqual({
      x: -GROUP_FRAME_PADDING,
      y: -GROUP_FRAME_PADDING,
      w: 40 + 2 * GROUP_FRAME_PADDING,
      h: 40 + 2 * GROUP_FRAME_PADDING,
    });
  });

  it('ignores a group whose frame is larger than needed when nodes reach further', () => {
    const doc = docOf(
      [node('a', 0, 0, 40, 40), node('b', 1000, 1000, 10, 10)],
      { g: { id: 'g', name: 'G' } },
    );
    doc.nodes['a']!.groupId = 'g';
    // Node b reaches far beyond the frame around a.
    // Union spans x/y: −16 … 1010 → 1026 wide/tall.
    expect(contentBounds(doc)).toEqual({ x: -16, y: -16, w: 1026, h: 1026 });
  });

  it('a group without members contributes nothing', () => {
    const doc = docOf([node('a', 5, 5, 10, 10)], {
      empty: { id: 'empty', name: 'E' },
    });
    expect(contentBounds(doc)).toEqual({ x: 5, y: 5, w: 10, h: 10 });
  });
});
