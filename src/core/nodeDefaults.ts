/**
 * Node defaults (T-007 R2).
 *
 * `newNode(id, kind, x, y)` builds a valid node whose top-left is `(x, y)`
 * with the default size, text and light fill colour for its kind. Pure and
 * deterministic: no DOM, no randomness, no clock (D-06, D-23). IDs come from
 * the caller (D-11).
 */

import type { Id, Node, NodeKind } from './types';

/** Default size per kind, in world units (R2). */
export const DEFAULT_NODE_SIZES: Record<NodeKind, { w: number; h: number }> =
  Object.freeze({
    text: Object.freeze({ w: 160, h: 40 }),
    sticky: Object.freeze({ w: 160, h: 120 }),
    card: Object.freeze({ w: 200, h: 120 }),
    image: Object.freeze({ w: 200, h: 150 }),
  });

/**
 * Light fill colour per kind (R2). Each kind gets its own constant; all are
 * light so the dark theme's text stays readable on top of them.
 */
export const NODE_COLORS: Record<NodeKind, string> = Object.freeze({
  text: '#f4f1ea', // warm paper
  sticky: '#fef3a2', // sticky-note yellow
  card: '#d7e5f7', // pale blue
  image: '#e5def2', // soft lavender
});

/** Default text per kind (R2): "New card" for cards, empty otherwise. */
const DEFAULT_TEXT: Record<NodeKind, string> = Object.freeze({
  text: '',
  sticky: '',
  card: 'New card',
  image: '',
});

/**
 * Create a node with the defaults for `kind`, top-left at `(x, y)` (R2).
 * `tags` is a fresh empty array per call; `groupId` is absent.
 */
export function newNode(id: Id, kind: NodeKind, x: number, y: number): Node {
  const size = DEFAULT_NODE_SIZES[kind];
  return {
    id,
    kind,
    x,
    y,
    w: size.w,
    h: size.h,
    text: DEFAULT_TEXT[kind],
    color: NODE_COLORS[kind],
    tags: [],
  };
}
