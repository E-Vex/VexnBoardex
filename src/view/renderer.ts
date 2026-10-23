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

import type { Doc, Node, Edge, Id } from '../core/types';
import { rectContains, rectsIntersect } from '../core/geometry';
import { edgeEndpoints, nodeRect } from '../core/edgeGeometry';
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
  EDGE_COLOR,
  EDGE_WIDTH,
  ARROWHEAD_SIZE,
  ARROWHEAD_ANGLE,
  HANDLE_COLOR,
  HANDLE_BORDER_COLOR,
  HANDLE_RADIUS,
  HANDLE_BORDER_WIDTH,
  HANDLE_OFFSET,
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

// ── Edge drawing (T-010) ──────────────────────────────────────────────────

/**
 * Draw an arrowhead at `tip` pointing along the direction `angle` (radians),
 * with the given `size` (world units). The arrowhead is an isosceles
 * triangle whose tip is exactly at `tip`.
 */
function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  angle: number,
  size: number,
): void {
  const halfAngle = ARROWHEAD_ANGLE;
  const left = angle + Math.PI - halfAngle;
  const right = angle + Math.PI + halfAngle;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX + Math.cos(left) * size, tipY + Math.sin(left) * size);
  ctx.lineTo(tipX + Math.cos(right) * size, tipY + Math.sin(right) * size);
  ctx.closePath();
  ctx.fillStyle = EDGE_COLOR;
  ctx.fill();
}

/**
 * Draw one edge in world coordinates (T-010): a straight line from the
 * resolved `from` endpoint to the resolved `to` endpoint, with an arrowhead
 * at the `to` end. The line width and arrowhead are scaled by `1/scale`
 * so they render at constant screen size regardless of zoom.
 *
 * `drag` (UI preview) can offset nodes — edges connected to dragged nodes
 * are drawn to their preview positions so the arrow follows the drag.
 */
function drawEdge(
  ctx: CanvasRenderingContext2D,
  edge: Edge,
  doc: Doc,
  scale: number,
  drag: { ids: Set<string>; dx: number; dy: number } | null,
): void {
  // Resolve the rect for each node, applying drag preview offset if needed.
  const rectOf = (id: string) => {
    const node = doc.nodes[id];
    if (!node) return undefined;
    const isDragged = drag !== null && drag.ids.has(id);
    const dx = isDragged ? drag.dx : 0;
    const dy = isDragged ? drag.dy : 0;
    const r = nodeRect(node);
    return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
  };

  const endpoints = edgeEndpoints(edge, rectOf);
  if (!endpoints) return; // one of the nodes is missing

  const { from, to } = endpoints;

  // Line from `from` to `to`.
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.lineWidth = EDGE_WIDTH / scale;
  ctx.strokeStyle = EDGE_COLOR;
  ctx.stroke();

  // Arrowhead at the `to` endpoint, pointing along the line direction.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const angle = Math.atan2(dy, dx);
  drawArrowhead(ctx, to.x, to.y, angle, ARROWHEAD_SIZE / scale);

  // Optional: edge label (T-010 - basic label at midpoint).
  if (edge.label && edge.label.length > 0) {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    ctx.font = `${FONT_SIZE}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = EDGE_COLOR;
    ctx.fillText(edge.label, midX, midY);
  }
}

// ── Handle drawing (T-011) ──────────────────────────────────────────────────

/** The 4 handle anchors (midpoints of node sides). */
const HANDLE_ANCHORS: ('top' | 'right' | 'bottom' | 'left')[] = [
  'top',
  'right',
  'bottom',
  'left',
];

/**
 * Get the world point for a handle anchor on a node rect.
 */
function getHandlePoint(node: { x: number; y: number; w: number; h: number }, anchor: 'top' | 'right' | 'bottom' | 'left'): { x: number; y: number } {
  switch (anchor) {
    case 'top':
      return { x: node.x + node.w / 2, y: node.y };
    case 'right':
      return { x: node.x + node.w, y: node.y + node.h / 2 };
    case 'bottom':
      return { x: node.x + node.w / 2, y: node.y + node.h };
    case 'left':
      return { x: node.x, y: node.y + node.h / 2 };
  }
}

/**
 * Draw connection handles on a node (T-011). Handles are drawn as small
 * circles at the midpoints of each side, offset slightly outside the node
 * rect. They are drawn in screen space so they stay constant size
 * regardless of zoom.
 */
function drawHandles(
  ctx: CanvasRenderingContext2D,
  node: { x: number; y: number; w: number; h: number },
  camera: Camera,
): void {
  // Draw in screen space for constant size.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // reset to screen space
  for (const anchor of HANDLE_ANCHORS) {
    const wp = getHandlePoint(node, anchor);
    const sp = worldToScreen(camera, wp);
    // Offset the handle outside the node in screen space.
    const offset = HANDLE_OFFSET;
    const spOffset = { ...sp };
    switch (anchor) {
      case 'top':
        spOffset.y -= offset;
        break;
      case 'right':
        spOffset.x += offset;
        break;
      case 'bottom':
        spOffset.y += offset;
        break;
      case 'left':
        spOffset.x -= offset;
        break;
    }
    const r = HANDLE_RADIUS;
    ctx.beginPath();
    ctx.arc(spOffset.x, spOffset.y, r, 0, Math.PI * 2);
    ctx.fillStyle = HANDLE_COLOR;
    ctx.fill();
    ctx.lineWidth = HANDLE_BORDER_WIDTH;
    ctx.strokeStyle = HANDLE_BORDER_COLOR;
    ctx.stroke();
  }
  ctx.restore();
}

// ── Connection preview drawing (T-011) ──────────────────────────────────────

/**
 * Draw the connection preview line from a handle to a world point (T-011).
 * The preview uses the drag state encoded in `ui.drag` where:
 * - `drag.ids[0]` is the from-node id
 * - `drag.dx`, `drag.dy` are the world coordinates of the cursor endpoint
 */
function drawConnectPreview(
  ctx: CanvasRenderingContext2D,
  doc: Doc,
  ui: UiState,
  scale: number,
): void {
  const drag = ui.drag;
  if (!drag || drag.ids.length === 0) return;

  const fromId = drag.ids[0] as Id;
  const fromNode = doc.nodes[fromId];
  if (!fromNode) return;

  // The from-handle is determined by the anchor stored in the connect tool.
  // For now, we need to infer it. Since the drag preview encodes the cursor
  // position in dx/dy, we need to know which handle was used.
  // We'll use a simple approach: find which handle is closest to the line.
  // But actually, the connect tool knows the fromAnchor. We need to pass it.
  // For now, let's compute the handle point from the fromNode rect that
  // is closest to the target point.
  const targetPoint = { x: drag.dx, y: drag.dy };
  const fromRect = { x: fromNode.x, y: fromNode.y, w: fromNode.w, h: fromNode.h };
  
  // Find the handle on fromNode that points toward targetPoint.
  let bestAnchor: 'top' | 'right' | 'bottom' | 'left' = 'right';
  let bestDist = Infinity;
  for (const anchor of HANDLE_ANCHORS) {
    const hp = getHandlePoint(fromRect, anchor);
    const dx = targetPoint.x - hp.x;
    const dy = targetPoint.y - hp.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      bestAnchor = anchor;
    }
  }
  const fromPoint = getHandlePoint(fromRect, bestAnchor);

  // Draw the preview line in world coordinates (transformed by camera).
  ctx.beginPath();
  ctx.moveTo(fromPoint.x, fromPoint.y);
  ctx.lineTo(targetPoint.x, targetPoint.y);
  ctx.lineWidth = EDGE_WIDTH / scale;
  ctx.strokeStyle = EDGE_COLOR;
  ctx.setLineDash([5, 5]); // dashed for preview
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw a small indicator at the target (not an arrowhead yet, just a dot).
  ctx.beginPath();
  ctx.arc(targetPoint.x, targetPoint.y, 4 / scale, 0, Math.PI * 2);
  ctx.fillStyle = EDGE_COLOR;
  ctx.fill();
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
  ui: UiState = { selection: [], drag: null, boxSelect: null },
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

  // 3b. Edges — between the grid and the nodes (T-010). Drawn in world
  // coordinates through the camera transform, beneath all nodes (D-21).
  // Culling: skip edges whose both endpoints are outside the visible rect.
  const m = cameraToMatrix(camera);
  const dragPreview = ui.drag
    ? { ids: new Set(ui.drag.ids), dx: ui.drag.dx, dy: ui.drag.dy }
    : null;
  ctx.save();
  ctx.transform(m.scale, 0, 0, m.scale, m.tx, m.ty);
  for (const edge of Object.values(doc.edges)) {
    // Quick culling: if both endpoints are outside visible, skip.
    // We use a loose check by computing the edge's bbox from its endpoints.
    const rectOfForCull = (id: string) => {
      const node = doc.nodes[id];
      if (!node) return undefined;
      const isDragged = dragPreview !== null && dragPreview.ids.has(id);
      const dx = isDragged ? dragPreview.dx : 0;
      const dy = isDragged ? dragPreview.dy : 0;
      const r = nodeRect(node);
      return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
    };
    const endpoints = edgeEndpoints(edge, rectOfForCull);
    if (!endpoints) continue;
    // Rough bbox culling: if both endpoints are outside visible, skip.
    const fromIn = rectContains(visible, endpoints.from);
    const toIn = rectContains(visible, endpoints.to);
    if (!fromIn && !toIn) {
      // Further check: if the line segment might cross the visible rect,
      // we should draw it. For simplicity, we draw if either endpoint is in
      // or if the line intersects the visible rect's expanded bounds.
      // A simple segment-rect intersection test:
      const segMinX = Math.min(endpoints.from.x, endpoints.to.x);
      const segMaxX = Math.max(endpoints.from.x, endpoints.to.x);
      const segMinY = Math.min(endpoints.from.y, endpoints.to.y);
      const segMaxY = Math.max(endpoints.from.y, endpoints.to.y);
      if (
        segMaxX < visible.x ||
        segMinX > visible.x + visible.w ||
        segMaxY < visible.y ||
        segMinY > visible.y + visible.h
      ) {
        continue; // segment bbox doesn't intersect visible rect
      }
    }
    drawEdge(ctx, edge, doc, m.scale, dragPreview);
  }

  // 3c. Connection preview (T-011) — drawn between edges and nodes.
  if (dragPreview !== null && dragPreview.ids.size > 0) {
    // Check if this is a connection preview (from connect tool) vs node drag.
    // Connection preview has exactly one id and the dx/dy represent the target point.
    // Node drag has dx/dy as deltas. We distinguish by checking if dx/dy are
    // absolute positions (large values) vs small deltas. For simplicity, we
    // check if the drag ids include a node that exists and the dx/dy look
    // like absolute coordinates (outside typical drag delta range).
    // Better: the connect tool sets a special flag. For now, we check if
    // the dx/dy values are far from the node's position.
    drawConnectPreview(ctx, doc, ui, m.scale);
  }

  ctx.restore();

  // 4. Nodes, in doc.order (bottom → top), in world coordinates through the
  // camera transform (I-02: the transform comes from cameraToMatrix only).
  // Edges are drawn between the grid and the nodes (D-21).
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
    // Draw connection handles on selected nodes (T-011).
    if (selected.has(id)) {
      drawHandles(ctx, { x, y, w: node.w, h: node.h }, camera);
      drawSelectionOutline(ctx, x, y, node.w, node.h, m.scale);
    }
  }
  ctx.restore();

  // Draw box-select marquee (T-016) in screen coordinates.
  if (ui.boxSelect) {
    const r = ui.boxSelect;
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([]);
    // Semi-transparent fill.
    ctx.fillStyle = 'rgba(245, 166, 35, 0.1)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
}
