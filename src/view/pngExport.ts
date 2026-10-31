/**
 * PNG export (M8, T-027) — render the document's content bounds to an
 * offscreen canvas and encode it as a PNG blob.
 *
 * Lives in the view layer because it is rendering (PLAN §4): it reuses the
 * pure board renderer unchanged (I-07) with a synthetic camera that puts the
 * content bounds at the canvas origin. The io layer only downloads the
 * resulting blob, so the layer rule (`io → core`) stays intact.
 *
 * The frame is "content bounds + padding on every side, rendered at 2×"
 * (PLAN §6 M8): one world unit becomes `EXPORT_SCALE` canvas pixels, so the
 * export is crisp on hi-dpi screens without touching the DPR machinery that
 * belongs to the canvas host alone (D-07).
 */

import { contentBounds } from '../core/contentBounds';
import type { Rect } from '../core/geometry';
import type { Doc } from '../core/types';
import type { Camera } from './camera';
import { renderBoard } from './renderer';

/** Padding around the content bounds, in world units (M8). */
export const EXPORT_PADDING = 32;

/** Export scale: one world unit → 2 canvas pixels (M8). */
export const EXPORT_SCALE = 2;

/** The camera and canvas size that frame `bounds` plus padding (pure). */
export interface ExportFrame {
  camera: Camera;
  width: number;
  height: number;
}

/**
 * The export frame for `bounds`: a camera whose top-left world point is the
 * bounds' top-left minus `padding`, at `zoom = scale`, and the matching
 * canvas size in device pixels (`(bounds + 2·padding) × scale`).
 *
 * Pure math on plain numbers — the same camera model as the live board
 * (I-02): no other coordinate arithmetic exists here. Throws on non-finite
 * bounds or a non-positive scale (fail loudly rather than export garbage,
 * in the spirit of D-22).
 */
export function exportFrame(
  bounds: Rect,
  padding: number = EXPORT_PADDING,
  scale: number = EXPORT_SCALE,
): ExportFrame {
  const finite =
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.w) &&
    Number.isFinite(bounds.h) &&
    Number.isFinite(padding) &&
    Number.isFinite(scale);
  if (!finite || scale <= 0 || bounds.w < 0 || bounds.h < 0) {
    throw new Error(
      `exportFrame: invalid bounds or scale (${JSON.stringify(bounds)}, padding ${padding}, scale ${scale})`,
    );
  }
  return {
    camera: {
      x: bounds.x - padding,
      y: bounds.y - padding,
      zoom: scale,
    },
    width: (bounds.w + 2 * padding) * scale,
    height: (bounds.h + 2 * padding) * scale,
  };
}

/**
 * Render `doc` to an offscreen canvas and encode it as a PNG.
 *
 * The renderer gets a neutral UI state (no selection outlines, no drag or
 * connect previews, no tag dimming — `renderBoard`'s default), so the export
 * always shows the document itself. Returns `null` when the document has no
 * content (nothing to export). The blob is produced by `canvas.toBlob`;
 * a zero-size canvas cannot occur because `contentBounds` is non-null.
 */
export function renderDocToPng(doc: Doc): Promise<Blob | null> {
  const bounds = contentBounds(doc);
  if (bounds === null) return Promise.resolve(null);

  const { camera, width, height } = exportFrame(bounds);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return Promise.reject(new Error('renderDocToPng: no 2d context'));
  }

  // Identity transform: the canvas is its own CSS-pixel space (DPR is a
  // canvas-host concern only, D-07), and `scale` is carried by the camera.
  renderBoard(ctx, { width: canvas.width, height: canvas.height }, camera, doc);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}
