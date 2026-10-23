/**
 * Document store (T-006 R6, PLAN I-03).
 *
 * Holds the current document. All mutations go through `dispatch(command)`,
 * which compiles the command to a patch, applies it strictly, stores the
 * new document, and notifies subscribers. Pure dependencies only.
 */

import type { Command, Doc, Patch } from './types';
import { validateDoc } from './doc';
import { applyPatch, isEmptyPatch } from './patch';
import { compileCommand } from './commands';
import { createHistory, createTransaction } from './history';

export interface DocStore {
  /** Returns the current document. */
  get(): Doc;
  /**
   * The revision counter (T-008 R2, D-29): starts at 0, increments by 1 for
   * every non-empty applied patch, unchanged for empty patches and failed
   * dispatches. Camera and UI state never touch it.
   */
  getRevision(): number;
  /**
   * Compile, apply and store. Returns the patch. An empty patch changes
   * nothing: no notification. If compile or apply throws, the document is
   * unchanged and nobody is notified (atomic).
   */
  dispatch(command: Command): Patch;
  /** Subscribe to document changes: `fn(doc, patch)` in subscription order. */
  subscribe(fn: (doc: Doc, patch: Patch) => void): () => void;
  /** Undo the last command. Returns the inverse patch applied, or null. */
  undo(): Patch | null;
  /** Redo the last undone command. Returns the patch applied, or null. */
  redo(): Patch | null;
  /** Check if undo is available. */
  canUndo(): boolean;
  /** Check if redo is available. */
  canRedo(): boolean;
  /** Get history size. */
  getHistorySize(): number;
  /** Get redo stack size. */
  getRedoSize(): number;
  /** Create a transaction for grouping multiple commands. */
  transaction(): ReturnType<typeof import('./history').createTransaction>;
  /** Clear all history. */
  clearHistory(): void;
}

/**
 * Create a document store. Throws if `validateDoc(initial)` is non-empty.
 */
export function createDocStore(initial: Doc, options: { now: () => number }): DocStore {
  const violations = validateDoc(initial);
  if (violations.length > 0) {
    throw new Error(
      `createDocStore: initial document is invalid:\n${violations.join('\n')}`,
    );
  }

  let current: Doc = initial;
  let revision = 0;
  const subscribers = new Set<(doc: Doc, patch: Patch) => void>();

  // History integration (T-015).
  const history = createHistory({ now: options.now });

  // Subscribe to history undo/redo to update the document.
  function applyHistoryPatch(patch: Patch): void {
    const next = applyPatch(current, patch);
    current = next;
    revision += 1;
    for (const fn of subscribers) {
      fn(current, patch);
    }
  }

  function dispatch(command: Command): Patch {
    // Compile may throw CommandError — doc stays unchanged.
    const patch = compileCommand(current, command);

    // applyPatch may throw PatchConflictError — doc stays unchanged.
    const next = applyPatch(current, patch);

    // Empty patch: no change, no notification (isEmptyPatch is the one
    // definition of "empty" — T-007 Part A-3).
    if (isEmptyPatch(patch)) {
      return patch;
    }

    current = next;
    revision += 1;

    // Push to history.
    history.push(patch);

    for (const fn of subscribers) {
      fn(current, patch);
    }
    return patch;
  }

  function undo(): Patch | null {
    const inverse = history.undo();
    if (!inverse) return null;
    applyHistoryPatch(inverse);
    return inverse;
  }

  function redo(): Patch | null {
    const patch = history.redo();
    if (!patch) return null;
    applyHistoryPatch(patch);
    return patch;
  }

  function canUndo(): boolean {
    return history.canUndo();
  }

  function canRedo(): boolean {
    return history.canRedo();
  }

  function getHistorySize(): number {
    return history.getPastLength();
  }

  function getRedoSize(): number {
    return history.getFutureLength();
  }

  function transaction() {
    return createTransaction(history);
  }

  function clearHistory(): void {
    history.clear();
  }

  return {
    get() {
      return current;
    },
    getRevision() {
      return revision;
    },
    dispatch,
    subscribe(fn: (doc: Doc, patch: Patch) => void): () => void {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
    undo,
    redo,
    canUndo,
    canRedo,
    getHistorySize,
    getRedoSize,
    transaction,
    clearHistory,
  };
}
