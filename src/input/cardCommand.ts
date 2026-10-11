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
import { newNode } from '../core/nodeDefaults';
import type { Command, Id } from '../core/types';

/**
 * A `node.create` command for a card centred on `world` (R7):
 * `x = world.x − w/2`, `y = world.y − h/2`, with `w`/`h` from `newNode`.
 * The id comes from the caller (D-11).
 */
export function createCardAt(world: Point, id: Id): Command {
  const base = newNode(id, 'card', 0, 0);
  return {
    type: 'node.create',
    node: {
      ...base,
      x: world.x - base.w / 2,
      y: world.y - base.h / 2,
    },
  };
}
