// T-029 — mind-map planner unit tests (M9). The planner is pure: positions
// are computed from the document, every plan is ONE batch command, and
// compiling + applying it always yields a valid document whose undo removes
// node AND edge together.
import { describe, expect, it } from 'vitest';

import type { Doc, Edge, Node } from '../core/types';
import { emptyDoc, validateDoc } from '../core/doc';
import { applyPatch } from '../core/patch';
import { compileCommand } from '../core/commands';
import { createDocStore } from '../core/store';
import {
  CHILD_GAP_X,
  SIBLING_GAP_Y,
  planChild,
  planRoot,
  planSibling,
  treeChildrenOf,
  treeParentOf,
} from './mindmap';

function node(id: string, overrides: Partial<Node> = {}): Node {
  return {
    id,
    kind: 'card',
    x: 0,
    y: 0,
    w: 200,
    h: 120,
    text: 'Idea',
    color: '#d7e5f7',
    tags: [],
    ...overrides,
  };
}

function edge(id: string, from: string, to: string): Edge {
  return { id, from: { node: from, anchor: 'auto' }, to: { node: to, anchor: 'auto' } };
}

function docWith(nodes: Node[], edges: Edge[] = []): Doc {
  const d = emptyDoc();
  for (const n of nodes) {
    d.nodes[n.id] = n;
    d.order.push(n.id);
  }
  for (const e of edges) {
    d.edges[e.id] = e;
  }
  return d;
}

describe('treeParentOf / treeChildrenOf', () => {
  it('finds the parent through the incoming edge', () => {
    const doc = docWith(
      [node('root'), node('a'), node('b')],
      [edge('e1', 'root', 'a'), edge('e2', 'root', 'b')],
    );
    expect(treeParentOf(doc, 'a')).toBe('root');
    expect(treeParentOf(doc, 'root')).toBeNull();
  });

  it('children are sorted top → bottom regardless of edge order', () => {
    const doc = docWith(
      [node('root'), node('low', { y: 400 }), node('high', { y: 100 })],
      [edge('e1', 'root', 'low'), edge('e2', 'root', 'high')],
    );
    expect(treeChildrenOf(doc, 'root')).toEqual(['high', 'low']);
  });

  it('reverse edges are not parent links (from = parent, always)', () => {
    const doc = docWith([node('a'), node('b')], [edge('e1', 'a', 'b')]);
    expect(treeParentOf(doc, 'a')).toBeNull();
    expect(treeChildrenOf(doc, 'b')).toEqual([]);
  });
});

describe('planRoot', () => {
  it('creates one card centred on the world point', () => {
    const command = planRoot({ x: 100, y: 50 }, 'n1');
    expect(command.type).toBe('batch');
    const doc = applyPatch(emptyDoc(), compileCommand(emptyDoc(), command));
    expect(doc.nodes.n1?.x).toBe(100 - 200 / 2);
    expect(doc.nodes.n1?.y).toBe(50 - 120 / 2);
    expect(validateDoc(doc)).toEqual([]);
  });
});

describe('planChild', () => {
  it('first child lands right of the parent, top aligned, with an edge', () => {
    const doc = docWith([node('root', { x: 0, y: 0, w: 200, h: 120 })]);
    const command = planChild(doc, 'root', 'c1', 'e1');
    const next = applyPatch(doc, compileCommand(doc, command));

    const child = next.nodes.c1!;
    expect(child.x).toBe(200 + CHILD_GAP_X);
    expect(child.y).toBe(0);
    expect(next.edges.e1).toEqual(edge('e1', 'root', 'c1'));
    expect(validateDoc(next)).toEqual([]);
  });

  it('the second child stacks below the first', () => {
    const doc = docWith(
      [node('root', { x: 0, y: 0 }), node('c1', { x: 200 + CHILD_GAP_X, y: 0 })],
      [edge('e1', 'root', 'c1')],
    );
    const next = applyPatch(doc, compileCommand(doc, planChild(doc, 'root', 'c2', 'e2')));

    expect(next.nodes.c2?.x).toBe(200 + CHILD_GAP_X);
    expect(next.nodes.c2?.y).toBe(120 + SIBLING_GAP_Y);
    expect(next.edges.e2).toEqual(edge('e2', 'root', 'c2'));
  });

  it('uses the bottom-most child even when it is not the first created', () => {
    const c1 = node('c1', { x: 280, y: 0 });
    const c2 = node('c2', { x: 280, y: 500, h: 60 });
    const doc = docWith(
      [node('root'), c1, c2],
      [edge('e1', 'root', 'c1'), edge('e2', 'root', 'c2')],
    );
    const next = applyPatch(doc, compileCommand(doc, planChild(doc, 'root', 'c3', 'e3')));
    expect(next.nodes.c3?.y).toBe(500 + 60 + SIBLING_GAP_Y);
  });
});

describe('planSibling', () => {
  it('sibling of a child shares the parent and lands below the stack bottom', () => {
    const root = node('root', { x: 0, y: 0 });
    const c1 = node('c1', { x: 280, y: 0 });
    const c2 = node('c2', { x: 280, y: 160 });
    const doc = docWith(
      [root, c1, c2],
      [edge('e1', 'root', 'c1'), edge('e2', 'root', 'c2')],
    );

    // Enter on c1 (the FIRST child): the sibling still goes below c2, the
    // bottom-most child, aligned with it.
    const next = applyPatch(
      doc,
      compileCommand(doc, planSibling(doc, 'c1', 's1', 'e3')),
    );
    expect(next.nodes.s1?.x).toBe(280);
    expect(next.nodes.s1?.y).toBe(160 + 120 + SIBLING_GAP_Y);
    expect(next.edges.e3).toEqual(edge('e3', 'root', 's1'));
    expect(validateDoc(next)).toEqual([]);
  });

  it('sibling of a root is a disconnected root below it (forest)', () => {
    const doc = docWith([node('r1', { x: 0, y: 0 })]);
    const next = applyPatch(
      doc,
      compileCommand(doc, planSibling(doc, 'r1', 'r2', 'e1')),
    );
    expect(next.nodes.r2?.x).toBe(0);
    expect(next.nodes.r2?.y).toBe(120 + SIBLING_GAP_Y);
    expect(Object.keys(next.edges)).toEqual([]);
  });
});

describe('mind-map plans through the store — one undo step', () => {
  it('undoing a child creation removes the node AND its edge', () => {
    const store = createDocStore(
      docWith([node('root')]),
      { now: () => 0 },
    );
    store.dispatch(planChild(store.get(), 'root', 'c1', 'e1'));
    expect(store.get().nodes.c1).toBeDefined();
    expect(store.get().edges.e1).toBeDefined();
    expect(store.getHistorySize()).toBe(1);

    store.undo();
    expect(store.get().nodes.c1).toBeUndefined();
    expect(store.get().edges.e1).toBeUndefined();
    expect(validateDoc(store.get())).toEqual([]);
  });

  it('undoing a sibling creation removes the node AND its edge', () => {
    const store = createDocStore(
      docWith(
        [node('root'), node('c1', { x: 280 })],
        [edge('e1', 'root', 'c1')],
      ),
      { now: () => 0 },
    );
    store.dispatch(planSibling(store.get(), 'c1', 's1', 'e2'));
    expect(store.getHistorySize()).toBe(1);
    store.undo();
    expect(store.get().nodes.s1).toBeUndefined();
    expect(store.get().edges.e2).toBeUndefined();
  });
});
