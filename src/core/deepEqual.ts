/**
 * `deepEqual` — structural equality for JSON-like data (T-006 R2).
 *
 * - Primitives compared with `===` (so `0` equals `-0`).
 * - Arrays compared by length and element-wise recursion.
 * - Plain objects compared by own enumerable keys, independent of key order.
 * - A key whose value is `undefined` counts as absent.
 *
 * No dependency. Does not handle `Date`, `RegExp`, `Map`, `Set` or other
 * non-JSON types — the document model is plain JSON.
 */

/** True when `a` and `b` are structurally equal (see above). */
export function deepEqual(a: unknown, b: unknown): boolean {
  // Primitives (and reference equality for objects, a fast path).
  if (a === b) return true;

  // null is a primitive already handled by === above.
  // Distinguish objects from primitives.
  const ta = typeof a;
  const tb = typeof b;
  if (ta !== tb) return false;
  if (a === null || b === null) return false;
  if (ta !== 'object') return false; // primitives of the same type already failed ===

  // Both are non-null objects. Arrays must match arrays.
  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;

  if (aIsArray) {
    const aa = a as unknown[];
    const bb = b as unknown[];
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i++) {
      if (!deepEqual(aa[i], bb[i])) return false;
    }
    return true;
  }

  // Plain objects: compare own enumerable keys, treating undefined as absent.
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bKeys = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bo, key)) return false;
    if (!deepEqual(ao[key], bo[key])) return false;
  }
  return true;
}
