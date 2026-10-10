/**
 * Grid math — pure, DOM-free (PLAN D-06, D-18, R1, R7).
 *
 * The grid is a field of dots at world coordinates that are integer multiples
 * of a step size. The step adapts to the zoom level so that dots stay at
 * least `MIN_ONSCREEN_SPACING` CSS pixels apart on screen, but not so far
 * apart that the grid becomes sparse.
 *
 * No DOM, no canvas, no state — just numbers. The renderer (renderer.ts)
 * calls these functions to decide what to draw.
 */

import type { Rect } from '../core/geometry';

/** Base grid spacing in world units (PLAN R1). */
export const BASE_STEP = 24;

/** Minimum on-screen spacing between dots, in CSS pixels (PLAN R1). */
export const MIN_ONSCREEN_SPACING = 16;

/** Clamp range for the exponent k in gridStep (PLAN R1). */
const K_MIN = -10;
const K_MAX = 10;

/** The inclusive range of dot indices that lie inside a world rect. */
export interface DotIndexRange {
  i0: number;
  i1: number;
  j0: number;
  j1: number;
}

/**
 * Returns the grid step (in world units) for a given zoom level.
 *
 * The step is `BASE_STEP × 2^k` for the smallest integer `k` (clamped to
 * [K_MIN, K_MAX]) such that `step × zoom ≥ MIN_ONSCREEN_SPACING`. A
 * non-finite or non-positive zoom returns `BASE_STEP` (24).
 *
 * At zoom 1 the step is 24 (24 CSS px on screen). As you zoom out the step
 * grows so dots never get closer than 16 CSS px; as you zoom in the step
 * shrinks so the grid stays useful.
 */
export function gridStep(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return BASE_STEP;
  // 2^k >= MIN_ONSCREEN_SPACING / (BASE_STEP * zoom)
  // k >= log2(MIN_ONSCREEN_SPACING / (BASE_STEP * zoom))
  const kRaw = Math.log2(MIN_ONSCREEN_SPACING / (BASE_STEP * zoom));
  const k = Math.ceil(kRaw);
  const kClamped = Math.min(K_MAX, Math.max(K_MIN, k));
  return BASE_STEP * Math.pow(2, kClamped);
}

/**
 * Returns the dot indices that lie inside `rect` for a given `step`.
 *
 * `i0 = ceil(rect.x / step)`, `i1 = floor((rect.x + rect.w) / step)`,
 * and similarly for `j` with `rect.y` and `rect.h`. A dot at index `(i, j)`
 * sits at world point `(i × step, j × step)`.
 */
export function dotIndexRange(rect: Rect, step: number): DotIndexRange {
  const i0 = Math.ceil(rect.x / step);
  const i1 = Math.floor((rect.x + rect.w) / step);
  const j0 = Math.ceil(rect.y / step);
  const j1 = Math.floor((rect.y + rect.h) / step);
  return { i0, i1, j0, j1 };
}

/**
 * The number of dots in a range: `max(0, i1−i0+1) × max(0, j1−j0+1)`.
 * Returns 0 when the range is empty (i1 < i0 or j1 < j0).
 */
export function dotCount(range: DotIndexRange): number {
  const ni = Math.max(0, range.i1 - range.i0 + 1);
  const nj = Math.max(0, range.j1 - range.j0 + 1);
  return ni * nj;
}
