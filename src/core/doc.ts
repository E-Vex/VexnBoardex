/**
 * `emptyDoc` — returns a fresh empty document (T-006 R3, PLAN §4).
 *
 * Each call returns a new object so callers can freely mutate the result
 * without affecting other documents.
 */

import type { Doc } from './types';

/** A fresh `{ nodes: {}, edges: {}, groups: {}, order: [] }` each call. */
export function emptyDoc(): Doc {
  return {
    nodes: {},
    edges: {},
    groups: {},
    order: [],
  };
}
