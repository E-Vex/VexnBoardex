/**
 * Undo/Redo history (T-015, PLAN D-09, D-22).
 *
 * History is a stack of patches. Undo applies the inverse patch.
 * Redo re-applies the forward patch.
 * Coalescing: rapid successive commands of the same type can be merged.
 * Transactions: multiple commands can be grouped into a single history entry.
 */

import type { Patch } from './types';
import { invertPatch, isEmptyPatch } from './patch';

/** A history entry: the patch that was applied. */
export interface HistoryEntry {
  patch: Patch;
  /** Optional description for UI (e.g., "Move nodes", "Delete node"). */
  description?: string;
}

/** Configuration for the history store. */
export interface HistoryConfig {
  /** Maximum history entries (older entries are dropped). Default 100. */
  maxSize?: number;
  /** Time window (ms) for coalescing rapid same-type commands. Default 300ms. */
  coalesceWindowMs?: number;
  /** Time source function for coalescing. Required for deterministic behavior. */
  now: () => number;
}

/** Default configuration values. */
const DEFAULT_MAX_SIZE = 100;
const DEFAULT_COALESCE_WINDOW_MS = 300;

/**
 * Create a history store.
 * - `undo()` applies the inverse of the most recent entry.
 * - `redo()` re-applies the most recently undone entry.
 * - `push(patch)` adds a new entry (clears redo stack).
 * - Coalescing merges rapid same-type commands within the time window.
 */
export function createHistory(config: HistoryConfig) {
  const maxSize = config.maxSize ?? DEFAULT_MAX_SIZE;
  const coalesceWindowMs = config.coalesceWindowMs ?? DEFAULT_COALESCE_WINDOW_MS;
  const now = config.now;

  let past: HistoryEntry[] = [];    // Applied patches (oldest first)
  let future: HistoryEntry[] = [];  // Undone patches (most recent first)
  let lastPushTime = 0;
  let lastPatchType: string | null = null;

  /**
   * Push a new patch to history.
   * If the patch is empty, does nothing.
   * Coalesces with previous entry if same type and within time window.
   */
  function push(patch: Patch, description?: string): void {
    if (isEmptyPatch(patch)) return;

    const currentTime = now();
    const patchType = getPatchType(patch);

    // Coalescing: if same type and within window, merge with previous entry.
    if (
      past.length > 0 &&
      lastPatchType === patchType &&
      currentTime - lastPushTime <= coalesceWindowMs
    ) {
      const lastEntry = past[past.length - 1]!;
      lastEntry.patch = mergePatches(lastEntry.patch, patch);
      lastEntry.description = description ?? lastEntry.description;
      lastPushTime = currentTime;
      return;
    }

    // Normal push: add to past, clear future.
    past.push({ patch, description });
    future = [];
    lastPushTime = currentTime;
    lastPatchType = patchType;

    // Trim to maxSize.
    if (past.length > maxSize) {
      past = past.slice(-maxSize);
    }
  }

  /** Undo the most recent entry. Returns the inverse patch to apply, or null if nothing to undo. */
  function undo(): Patch | null {
    if (past.length === 0) return null;
    const entry = past.pop()!;
    const inverse = invertPatch(entry.patch);
    future.push(entry);
    lastPatchType = null; // Reset coalescing after undo.
    return inverse;
  }

  /** Redo the most recently undone entry. Returns the patch to apply, or null if nothing to redo. */
  function redo(): Patch | null {
    if (future.length === 0) return null;
    const entry = future.pop()!;
    past.push(entry);
    lastPushTime = now();
    lastPatchType = getPatchType(entry.patch);
    return entry.patch;
  }

  /** Check if undo is available. */
  function canUndo(): boolean {
    return past.length > 0;
  }

  /** Check if redo is available. */
  function canRedo(): boolean {
    return future.length > 0;
  }

  /** Get history size. */
  function getPastLength(): number {
    return past.length;
  }

  /** Get redo stack size. */
  function getFutureLength(): number {
    return future.length;
  }

  /** Clear all history. */
  function clear(): void {
    past = [];
    future = [];
    lastPatchType = null;
  }

  return {
    push,
    undo,
    redo,
    canUndo,
    canRedo,
    getPastLength,
    getFutureLength,
    clear,
  };
}

/** Determine the "type" of a patch for coalescing purposes. */
function getPatchType(patch: Patch): string {
  const hasNodes = Object.keys(patch.nodes).length > 0;
  const hasEdges = Object.keys(patch.edges).length > 0;
  const hasGroups = Object.keys(patch.groups).length > 0;
  const hasOrder = patch.order !== undefined;

  if (hasNodes && !hasEdges && !hasGroups && !hasOrder) {
    const nodeChanges = Object.values(patch.nodes);
    const allMove = nodeChanges.every((c) => c.before && c.after);
    const allCreate = nodeChanges.every((c) => !c.before && c.after);
    const allDelete = nodeChanges.every((c) => c.before && !c.after);
    if (allMove) return 'node.move';
    if (allCreate) return 'node.create';
    if (allDelete) return 'node.delete';
    return 'node.mixed';
  }
  if (hasEdges && !hasNodes && !hasGroups) {
    return 'edge';
  }
  if (hasGroups) {
    return 'group';
  }
  return 'other';
}

/**
 * Merge two patches of the same type (for coalescing).
 * This is a simplified merge: the 'before' of the first, 'after' of the second.
 * Assumes both patches affect the same entities in sequence.
 */
function mergePatches(first: Patch, second: Patch): Patch {
  const mergeMap = <T>(
    firstMap: Record<string, { before?: T; after?: T }>,
    secondMap: Record<string, { before?: T; after?: T }>
  ): Record<string, { before?: T; after?: T }> => {
    const result: Record<string, { before?: T; after?: T }> = {};
    const allKeys = new Set([...Object.keys(firstMap), ...Object.keys(secondMap)]);
    for (const key of allKeys) {
      const f = firstMap[key];
      const s = secondMap[key];
      if (f && s) {
        result[key] = { before: f.before, after: s.after };
      } else if (f) {
        result[key] = f;
      } else if (s) {
        result[key] = s;
      }
    }
    return result;
  };

  return {
    nodes: mergeMap(first.nodes, second.nodes),
    edges: mergeMap(first.edges, second.edges),
    groups: mergeMap(first.groups, second.groups),
    order: first.order && second.order
      ? { before: first.order.before, after: second.order.after }
      : first.order ?? second.order,
  };
}

/**
 * Transaction helper: groups multiple commands into a single history entry.
 * Usage:
 *   const tx = history.transaction();
 *   docStore.dispatch(cmd1);
 *   docStore.dispatch(cmd2);
 *   tx.commit(); // pushes one combined patch
 *
 * If an error occurs, call tx.rollback() to discard.
 */
export function createTransaction(history: ReturnType<typeof createHistory>) {
  const patches: Patch[] = [];

  return {
    /** Add a patch to the transaction. */
    add(patch: Patch): void {
      if (!isEmptyPatch(patch)) patches.push(patch);
    },
    /** Commit: combine all patches into one and push to history. */
    commit(description?: string): void {
      if (patches.length === 0) return;
      if (patches.length === 1) {
        history.push(patches[0]!, description);
      } else {
        // Combine all patches sequentially.
        let combined = patches[0]!;
        for (let i = 1; i < patches.length; i++) {
          combined = mergePatches(combined, patches[i]!);
        }
        history.push(combined, description);
      }
      patches.length = 0;
    },
    /** Rollback: discard the transaction. */
    rollback(): void {
      patches.length = 0;
    },
  };
}