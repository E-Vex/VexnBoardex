/**
 * Board renderer — a pure function of (ctx, viewport, camera, doc, ui)
 * (PLAN D-10, I-07, T-007 R6, T-008 R5). Draws the background, a dotted
 * grid, an origin cross marker, then the document's nodes in `doc.order`
 * order (bottom → top, D-21). Edges will later be drawn between the grid
 * and the nodes. Keeps no state of its own.
 *
 * The UI layer (`ui` = selection + drag preview, D-25) only affects how a
 * node is drawn — never the document: nodes in `ui.drag.ids` are drawn
 * offset by `(dx, dy)` (a preview, I-04) and selected nodes get an accent
 * outline outside their rect (T-008 R5).
 *
 * `ctx` must already be scaled so the caller draws in CSS pixels (the canvas
 * host sets up the DPR transform). Any rounding happens only at draw time
 * (the canvas rasteriser), never in camera math.
 *
 * Nodes are drawn in world coordinates inside `save`/`restore` using the
 * transform from `cameraToMatrix` (I-02: no other camera arithmetic for
 * nodes in this file — `visibleWorldRect` is used only for culling).
 */

import type { Doc, Node } from '../core/types';
import { rectContains, rectsIntersect } from '../core/geometry';
import {
  type Camera,
  cameraToMatrix,
  visibleWorldRect,
  worldToScreen,
} from './camera';
import { dotCount, dotIndexRange, gridStep } from './grid';
import { layoutText } from './textLayout';
import type { UiState } from './uiStore';
import {
  BG_COLOR,
  CORNER_RADIUS,
  FONT_SIZE,
  FONT_STACK,
  GRID_DOT_COLOR,
  LINE_HEIGHT,
  MIN_TEXT_SIZE,
  NODE_BORDER_COLOR,
  NODE_BORDER_WIDTH,
  NODE_PADDING,
  NODE_TEXT_COLOR,
  ORIGIN_MARKER_COLOR,
  SELECTION_COLOR,
  SELECTION_OUTLINE_OFFSET,
  SELECTION_OUTLINE_WIDTH,
} from './theme';

// ── Visual constants (all in one place, per R3) ──────────────────────────
// Board colours and node typography live in theme.ts (T-007 R5); only
// renderer-specific metrics stay here.

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

// ── Node drawing ──────────────────────────────────────────────────────────

// (The node's bounding rect is built inline where culling needs it.)

/**
 * Draw one node in world coordinates (R6): a rounded rectangle filled with
 * the node's colour, a 1-unit border, and its text laid out by `layoutText`
 * using `ctx.measureText` — left-aligned, from the top padding, limited to
 * the lines that fit the node height. Text is skipped entirely when
 * `FONT_SIZE × scale` is below the minimum on-screen size (text LOD).
 *
 * `dx`/`dy` (T-008 R5) shift the whole node by the drag preview offset in
 * world units — the document is not touched. `scale` is the camera zoom
 * from the transform (not recomputed here).
 */
function drawNode(
  ctx: CanvasRenderingContext2D,
  node: Node,
  scale: number,
  dx = 0,
  dy = 0,
): void {
  const { x: nx, y: ny, w, h } = node;
  const x = nx + dx;
  const y = ny + dy;

  // Rounded rectangle via arcTo (R6), radius clamped to half the shorter side.
  const r = Math.min(CORNER_RADIUS, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = node.color;
  ctx.fill();
  ctx.lineWidth = NODE_BORDER_WIDTH;
  ctx.strokeStyle = NODE_BORDER_COLOR;
  ctx.stroke();

  // Text LOD (R6): below the minimum on-screen size, skip the text.
  if (FONT_SIZE * scale < MIN_TEXT_SIZE) return;
  if (node.text === '') return;

  const innerW = w - NODE_PADDING * 2;
  const innerH = h - NODE_PADDING * 2;
  if (innerW <= 0 || innerH <= 0) return;

  const lineH = FONT_SIZE * LINE_HEIGHT;
  const maxLines = Math.floor(innerH / lineH);
  if (maxLines < 1) return;

  ctx.font = `${FONT_SIZE}px ${FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = NODE_TEXT_COLOR;

  const lines = layoutText(
    node.text,
    innerW,
    (s) => ctx.measureText(s).width,
    maxLines,
  );
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, x + NODE_PADDING, y + NODE_PADDING + i * lineH);
  }
}

// ── Selection outline (T-008 R5) ───────────────────────────────────────────

/**
 * Stroke the selection outline for a node whose rect is `(x, y, w, h)` in
 * world coordinates: an accent rounded rect `SELECTION_OUTLINE_OFFSET`
 * screen px outside the node, `SELECTION_OUTLINE_WIDTH` screen px wide —
 * both divided by `scale` (the zoom from `cameraToMatrix`), so they paint
 * the same size on screen at any zoom. Drawn entirely OUTSIDE the node
 * rect, so the fill area is unchanged and T-007's pixel probes stay valid.
 */
function drawSelectionOutline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
): void {
  const off = SELECTION_OUTLINE_OFFSET / scale;
  const r = Math.min(CORNER_RADIUS, w / 2, h / 2) + off;
  ctx.beginPath();
  ctx.moveTo(x - off + r, y - off);
  ctx.arcTo(x + w + off, y - off, x + w + off, y + h + off, r);
  ctx.arcTo(x + w + off, y + h + off, x - off, y + h + off, r);
  ctx.arcTo(x - off, y + h + off, x - off, y - off, r);
  ctx.arcTo(x - off, y - off, x + w + off, y - off, r);
  ctx.closePath();
  ctx.lineWidth = SELECTION_OUTLINE_WIDTH / scale;
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.stroke();
}

// ── Renderer ─────────────────────────────────────────────────────────────

/**
 * Draws the board (T-007 R6, T-008 R5): background fill, grid dots (one
 * path + one fill), a small cross at world (0, 0) when visible, then the
 * nodes in `doc.order` order (bottom → top). Nodes are culled against the
 * visible world rect and drawn in world coordinates through the camera
 * transform.
 *
 * `ui` (D-25) is optional and defaults to an empty selection with no drag,
 * so callers without UI state keep working; the document itself is never
 * read-modified-written here (I-07, D-10).
 *
 * The grid is skipped entirely when `dotCount` exceeds `MAX_DOTS` (safety
 * cap, R3). The function keeps no state (I-07, D-10).
 */
export function renderBoard(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  camera: Camera,
  doc: Doc,
  ui: UiState = { selection: [], drag: null },
): void {
  const { width, height } = viewport;

  // 1. Background — always drawn.
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, width, height);

  // 2. Grid dots — one path, one fill (R3).
  const visible = visibleWorldRect(camera, width, height);
  const step = gridStep(camera.zoom);
  const range = dotIndexRange(visible, step);
  const count = dotCount(range);

  if (count <= MAX_DOTS) {
    ctx.fillStyle = GRID_DOT_COLOR;
    ctx.beginPath();
    const half = DOT_SIZE / 2;
    for (let j = range.j0; j <= range.j1; j++) {
      for (let i = range.i0; i <= range.i1; i++) {
        const s = worldToScreen(camera, {
          x: i * step,
          y: j * step,
        });
        ctx.rect(s.x - half, s.y - half, DOT_SIZE, DOT_SIZE);
      }
    }
    ctx.fill();
  }

  // 3. Origin cross marker — only when world (0, 0) is inside the visible rect.
  const origin = { x: 0, y: 0 };
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

  // 4. Nodes, in doc.order (bottom → top), in world coordinates through the
  // camera transform (I-02: the transform comes from cameraToMatrix only).
  // Edges will later be drawn here, between the grid and the nodes.
  const m = cameraToMatrix(camera);
  const selected = new Set(ui.selection);
  const drag = ui.drag;
  const draggedIds = drag !== null ? new Set(drag.ids) : null;
  const dragDx = drag !== null ? drag.dx : 0;
  const dragDy = drag !== null ? drag.dy : 0;
  ctx.save();
  ctx.transform(m.scale, 0, 0, m.scale, m.tx, m.ty);
  for (const id of doc.order) {
    const node = doc.nodes[id];
    if (node === undefined) continue; // defensive: order must be a permutation
    // Drag preview offset (R5): drawn at the offset position; the document
    // is not touched. Culling uses the rect actually drawn.
    const isDragged = draggedIds !== null && draggedIds.has(id);
    const dx = isDragged ? dragDx : 0;
    const dy = isDragged ? dragDy : 0;
    const x = node.x + dx;
    const y = node.y + dy;
    // Culling (R6): skip nodes whose drawn rect does not intersect the
    // visible rect — a selected node is culled like any other (R5).
    if (!rectsIntersect({ x, y, w: node.w, h: node.h }, visible)) continue;
    drawNode(ctx, node, m.scale, dx, dy);
    if (selected.has(id)) {
      drawSelectionOutline(ctx, x, y, node.w, node.h, m.scale);
    }
  }
  ctx.restore();
}
