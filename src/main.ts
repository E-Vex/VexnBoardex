// VexBoard entry point (T-004): wires the canvas host, board renderer, cursor
// tracker and HUD. No camera input yet — pan/zoom is T-005.
import './style.css';
import { createCursorTracker } from './input/cursor';
import { createHud } from './ui/hud';
import { cameraCenteredOn, type Camera } from './view/camera';
import { createCanvasHost } from './view/canvasHost';
import { renderBoard } from './view/renderer';

// Initial camera: world (0, 0) centered in the viewport (R6).
// On resize the camera stays as-is (top-left anchored) — no recentering.
const camera: Camera = cameraCenteredOn(
  { x: 0, y: 0 },
  window.innerWidth,
  window.innerHeight,
  1,
);

// Canvas host first so the HUD overlays it in DOM order.
const host = createCanvasHost(({ ctx, width, height }) => {
  renderBoard(ctx, { width, height }, camera);
});

// HUD overlay: cursor changes update the HUD only — no canvas redraw (R6).
const hud = createHud();
hud.update(camera, null);

// Cursor tracker runs autonomously — its callback updates the HUD only.
createCursorTracker(host.canvas, (pos) => {
  hud.update(camera, pos);
});

// Initial paint — renders on demand, never in a continuous loop (D-10).
host.requestRender();
