/**
 * Card creation command (T-007 R7) — pure, DOM-free.
 *
 * `createCardAt(world, id)` builds the `node.create` command for a card
 * centred on the world point `world`, using `newNode` for every default
 * (size, text, colour). The only arithmetic here is centring: the command
 * layer (core) stays the single mutation path (I-03) and the renderer/HUD
 * only observe the resulting document.
 */

import type { Point } from '../core/geometry';
import { hitTest } from '../core/hitTest';
import { newNode } from '../core/nodeDefaults';
import type { Command, Doc, Id, NodeKind } from '../core/types';

/**
 * A `node.create` command for a node of `kind` centred on `world` (T-019):
 * `x = world.x − w/2`, `y = world.y − h/2`, with `w`/`h` from `newNode`.
 * The id comes from the caller (D-11).
 */
export function createNodeAt(kind: NodeKind, world: Point, id: Id): Command {
  const base = newNode(id, kind, 0, 0);
  return {
    type: 'node.create',
    node: {
      ...base,
      x: world.x - base.w / 2,
      y: world.y - base.h / 2,
    },
  };
}

/**
 * A `node.create` command for a card centred on `world` (R7):
 * `x = world.x − w/2`, `y = world.y − h/2`, with `w`/`h` from `newNode`.
 * The id comes from the caller (D-11).
 */
export function createCardAt(world: Point, id: Id): Command {
  return createNodeAt('card', world, id);
}

/**
 * The "may I create a card here?" decision (T-008 R6, D-28), pure and
 * DOM-free: a double-click may create a card only on **empty space** — a
 * double-click on an existing node creates nothing (reserved for text
 * editing later).
 */
export function shouldCreateCardAt(doc: Doc, world: Point): boolean {
  return hitTest(doc, world) === null;
}
