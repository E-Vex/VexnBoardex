/**
 * Board renderer — a pure function of (ctx, viewport, camera) (PLAN D-10,
 * I-07). Draws the background, a dotted grid and an origin cross marker.
 * Keeps no state of its own.
 *
 * `ctx` must already be scaled so the caller draws in CSS pixels (the canvas
 * host sets up the DPR transform). Any rounding happens only at draw time
 * (the canvas rasteriser), never in camera math.
 */

import type { Point, Rect } from '../core/geometry';
import { rectContains } from '../core/geometry';
import { type Camera, visibleWorldRect, worldToScreen } from './camera';
import { dotCount, dotIndexRange, gridStep } from './grid';

// ── Visual constants (all in one place, per R3) ──────────────────────────

/** Solid background colour. */
const BG_COLOR = '#1e1e24';

/** Grid dot colour (slightly lighter than the background). */
const GRID_DOT_COLOR = '#3a3a46';

/** Origin cross marker colour. */
const ORIGIN_MARKER_COLOR = '#e8e8ef';

/** Half-size of the origin cross, in CSS pixels (total span = 2 × this). */
const ORIGIN_MARKER_HALF = 4;

/** Safety cap: skip the grid if the dot count exceeds this (R3). */
const MAX_DOTS = 50_000;

/** Grid dot size in CSS pixels (drawn as a small square). */
const DOT_SIZE = 1;

// ── Types ─────────────────────────────────────────────────────────────────

export interface Viewport {
  width: number;
  height: number;
}

// ── Renderer ─────────────────────────────────────────────────────────────

/**
 * Draws the board: background fill, grid dots (one path + one fill), and a
 * small cross at world (0, 0) when it is visible.
 *
 * The grid is skipped entirely when `dotCount` exceeds `MAX_DOTS` (safety
 * cap, R3). The function keeps no state (I-07, D-10).
 */
export function renderBoard(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  camera: Camera,
): void {
  const { width, height } = viewport;

  // 1. Background — always drawn.
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, width, height);

  // 2. Grid dots — one path, one fill (R3).
  const visible: Rect = visibleWorldRect(camera, width, height);
  const step = gridStep(camera.zoom);
  const range = dotIndexRange(visible, step);
  const count = dotCount(range);

  if (count <= MAX_DOTS) {
    ctx.fillStyle = GRID_DOT_COLOR;
    ctx.beginPath();
    const half = DOT_SIZE / 2;
    for (let j = range.j0; j <= range.j1; j++) {
      for (let i = range.i0; i <= range.i1; i++) {
        const s: Point = worldToScreen(camera, {
          x: i * step,
          y: j * step,
        });
        ctx.rect(s.x - half, s.y - half, DOT_SIZE, DOT_SIZE);
      }
    }
    ctx.fill();
  }

  // 3. Origin cross marker — only when world (0, 0) is inside the visible rect.
  const origin: Point = { x: 0, y: 0 };
  if (rectContains(visible, origin)) {
    const s = worldToScreen(camera, origin);
    ctx.strokeStyle = ORIGIN_MARKER_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s.x - ORIGIN_MARKER_HALF, s.y);
    ctx.lineTo(s.x + ORIGIN_MARKER_HALF, s.y);
    ctx.moveTo(s.x, s.y - ORIGIN_MARKER_HALF);
    ctx.lineTo(s.x, s.y + ORIGIN_MARKER_HALF);
    ctx.stroke();
  }
}
