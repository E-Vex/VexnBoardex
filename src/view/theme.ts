/**
 * Theme constants (T-007 R5) — colours, typography and metrics for the board.
 *
 * Constants only: no DOM, no functions with state, nothing computed at runtime
 * (enforced by the DOM-free ESLint override). Sizes are in world units unless
 * the name says CSS px (1 world unit = 1 CSS px at zoom 1, PLAN D-07).
 */

// ── Board (values moved from renderer.ts, unchanged — T-004 R3) ──────────

/** Solid board background colour. */
export const BG_COLOR = '#1e1e24';

/** Grid dot colour (slightly lighter than the background). */
export const GRID_DOT_COLOR = '#3a3a46';

/** Origin cross marker colour. */
export const ORIGIN_MARKER_COLOR = '#e8e8ef';

// ── Typography (T-007 R5) ─────────────────────────────────────────────────

/** Node text font stack (world-space; scaled by the camera at draw time). */
export const FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Node text size in world units (R5). */
export const FONT_SIZE = 16;

/** Line height as a multiple of FONT_SIZE (R5). */
export const LINE_HEIGHT = 1.3;

/**
 * Minimum on-screen text size in CSS px (R5): when
 * `FONT_SIZE × zoom` falls below this, node text is not drawn at all.
 */
export const MIN_TEXT_SIZE = 4;

// ── Node chrome (T-007 R5) ────────────────────────────────────────────────

/** Inner padding between a node's border and its text, in world units. */
export const NODE_PADDING = 12;

/** Node corner radius, in world units. */
export const CORNER_RADIUS = 8;

/** Node border width, in world units (a 1-unit border, R6). */
export const NODE_BORDER_WIDTH = 1;

/** Node text colour — dark ink on the light node fills (core/nodeDefaults). */
export const NODE_TEXT_COLOR = '#23262e';

/** Node border colour — a translucent dark ink over the fill. */
export const NODE_BORDER_COLOR = 'rgba(35, 38, 46, 0.35)';
