/**
 * Mind-map tree planning (T-029, M9) — pure, DOM-free.
 *
 * The mind map is not a separate data model (D-14): it is a *behaviour* on
 * the ordinary document. The tree is defined by the existing edges — an edge
 * `from → to` means "`from" is the parent of "`to" — and planning a new node
 * means computing where it lands and returning a single `batch` command
 * (node.create + edge.create), so growing the map is ONE undo step.
 *
 * Placement rules (deterministic, overlap-free within the grown tree):
 * - child: to the RIGHT of its parent; below the parent's existing children.
 * - sibling: below the bottom-most child of the shared parent, aligned with
 *   it (the common case — Enter on the last child — continues the column).
 * - root (Enter on a parentless node): directly below that node, no edge.
 */

import type { Command, Doc, Edge, Id, Node } from '../core/types';
import { newNode } from '../core/nodeDefaults';

/** Horizontal gap between a parent's right edge and a child's left edge. */
export const CHILD_GAP_X = 80;
/** Vertical gap between consecutive children / siblings. */
export const SIBLING_GAP_Y = 40;

/** The default text for mind-map nodes (roots, children and siblings). */
const MINDMAP_TEXT = 'Idea';

/**
 * The tree parent of `nodeId`: the `from` node of the FIRST edge (in
 * `doc.edges` insertion order) that points at it. Deterministic for any
 * document; `null` when no edge targets the node (a root). Multiple
 * incoming edges are the user's business — planning always uses the first.
 */
export function treeParentOf(doc: Doc, nodeId: Id): Id | null {
  for (const edge of Object.values(doc.edges)) {
    if (edge.to.node === nodeId) return edge.from.node;
  }
  return null;
}

/**
 * The tree children of `nodeId`: distinct `to` nodes of its outgoing edges,
 * sorted by position (top → bottom, then left → right) so placement math is
 * independent of edge insertion order.
 */
export function treeChildrenOf(doc: Doc, nodeId: Id): Id[] {
  const children = new Set<Id>();
  for (const edge of Object.values(doc.edges)) {
    if (edge.from.node === nodeId) children.add(edge.to.node);
  }
  return [...children].sort((a, b) => {
    const na = doc.nodes[a];
    const nb = doc.nodes[b];
    if (!na || !nb) return 0;
    if (na.y !== nb.y) return na.y - nb.y;
    return na.x - nb.x;
  });
}

/** The bottom-most child node of `parentId`, or null when it has none. */
function bottomChild(doc: Doc, parentId: Id): Node | null {
  const children = treeChildrenOf(doc, parentId);
  if (children.length === 0) return null;
  // treeChildrenOf is sorted top → bottom; the last child is the bottom-most.
  return doc.nodes[children[children.length - 1]!] ?? null;
}

/**
 * The `node.create` command for a mind-map root centred on `world` (T-029).
 * A batch of one so callers can treat every plan uniformly.
 */
export function planRoot(world: { x: number; y: number }, id: Id): Command {
  const base = newNode(id, 'card', 0, 0);
  return {
    type: 'batch',
    commands: [
      {
        type: 'node.create',
        node: {
          ...base,
          x: world.x - base.w / 2,
          y: world.y - base.h / 2,
          text: MINDMAP_TEXT,
        },
      },
    ],
  };
}

/**
 * Plan a child of `parentId` (T-029): a new card to the right of the
 * parent — below the parent's existing children when there are any, top
 * aligned with the parent otherwise — plus the parent → child edge, in ONE
 * batch command.
 */
export function planChild(
  doc: Doc,
  parentId: Id,
  childId: Id,
  edgeId: Id,
): Command {
  const parent = doc.nodes[parentId]!;
  const bottom = bottomChild(doc, parentId);
  const child = newNode(
    childId,
    'card',
    parent.x + parent.w + CHILD_GAP_X,
    bottom === null ? parent.y : bottom.y + bottom.h + SIBLING_GAP_Y,
  );
  const e: Edge = {
    id: edgeId,
    from: { node: parentId, anchor: 'auto' },
    to: { node: childId, anchor: 'auto' },
  };
  return {
    type: 'batch',
    commands: [
      { type: 'node.create', node: { ...child, text: MINDMAP_TEXT } },
      { type: 'edge.create', edge: e },
    ],
  };
}

/**
 * Plan a sibling of `nodeId` (T-029): a new card sharing `nodeId`'s tree
 * parent and its edge, placed below the parent's bottom-most child and
 * aligned with it. A parentless node gets a sibling ROOT directly below
 * itself, with no edge (mind-map forests).
 */
export function planSibling(
  doc: Doc,
  nodeId: Id,
  siblingId: Id,
  edgeId: Id,
): Command {
  const selected = doc.nodes[nodeId]!;
  const parentId = treeParentOf(doc, nodeId);

  // Root: a sibling root below, disconnected.
  if (parentId === null) {
    const root = newNode(
      siblingId,
      'card',
      selected.x,
      selected.y + selected.h + SIBLING_GAP_Y,
    );
    return {
      type: 'batch',
      commands: [
        { type: 'node.create', node: { ...root, text: MINDMAP_TEXT } },
      ],
    };
  }

  const bottom = bottomChild(doc, parentId);
  const x = bottom === null ? selected.x : bottom.x;
  const y =
    bottom === null
      ? selected.y + selected.h + SIBLING_GAP_Y
      : bottom.y + bottom.h + SIBLING_GAP_Y;
  const sibling = newNode(siblingId, 'card', x, y);
  const e: Edge = {
    id: edgeId,
    from: { node: parentId, anchor: 'auto' },
    to: { node: siblingId, anchor: 'auto' },
  };
  return {
    type: 'batch',
    commands: [
      { type: 'node.create', node: { ...sibling, text: MINDMAP_TEXT } },
      { type: 'edge.create', edge: e },
    ],
  };
}
