/**
 * Document store (T-006 R6, PLAN I-03).
 *
 * Holds the current document. All mutations go through `dispatch(command)`,
 * which compiles the command to a patch, applies it strictly, stores the
 * new document, and notifies subscribers. Pure dependencies only.
 */

import type { Command, Doc, Patch } from './types';
import { validateDoc } from './doc';
import { applyPatch } from './patch';
import { compileCommand } from './commands';

export interface DocStore {
  /** Returns the current document. */
  get(): Doc;
  /**
   * Compile, apply and store. Returns the patch. An empty patch changes
   * nothing: no notification. If compile or apply throws, the document is
   * unchanged and nobody is notified (atomic).
   */
  dispatch(command: Command): Patch;
  /** Subscribe to document changes: `fn(doc, patch)` in subscription order. */
  subscribe(fn: (doc: Doc, patch: Patch) => void): () => void;
}

/**
 * Create a document store. Throws if `validateDoc(initial)` is non-empty.
 */
export function createDocStore(initial: Doc): DocStore {
  const violations = validateDoc(initial);
  if (violations.length > 0) {
    throw new Error(
      `createDocStore: initial document is invalid:\n${violations.join('\n')}`,
    );
  }

  let current: Doc = initial;
  const subscribers = new Set<(doc: Doc, patch: Patch) => void>();

  return {
    get() {
      return current;
    },
    dispatch(command: Command): Patch {
      // Compile may throw CommandError — doc stays unchanged.
      const patch = compileCommand(current, command);

      // applyPatch may throw PatchConflictError — doc stays unchanged.
      const next = applyPatch(current, patch);

      // Empty patch: no change, no notification.
      if (
        Object.keys(patch.nodes).length === 0 &&
        Object.keys(patch.edges).length === 0 &&
        Object.keys(patch.groups).length === 0 &&
        patch.order === undefined
      ) {
        return patch;
      }

      current = next;
      for (const fn of subscribers) {
        fn(current, patch);
      }
      return patch;
    },
    subscribe(fn: (doc: Doc, patch: Patch) => void): () => void {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
  };
}
