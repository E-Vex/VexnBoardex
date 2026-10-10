// VexBoard entry point (T-005): wires the camera store, board renderer, cursor
// tracker, HUD and camera input (pan/zoom). Camera changes flow through the
// store, which triggers a re-render and a HUD update.
import './style.css';
import { attachCameraInput } from './input/cameraInput';
import { createCursorTracker } from './input/cursor';
import { createHud } from './ui/hud';
import { cameraCenteredOn } from './view/camera';
import { createCameraStore } from './view/cameraStore';
import { createCanvasHost } from './view/canvasHost';
import { renderBoard } from './view/renderer';

// Initial camera: world (0, 0) centered in the viewport at zoom 1 (R6).
const initialCamera = cameraCenteredOn(
  { x: 0, y: 0 },
  window.innerWidth,
  window.innerHeight,
  1,
);

// The camera store is the single source of truth for the view-layer camera.
const store = createCameraStore(initialCamera);

// Canvas host: the render callback reads the current camera from the store.
const host = createCanvasHost(({ ctx, width, height }) => {
  renderBoard(ctx, { width, height }, store.get());
});

// HUD overlay + cursor tracker. The cursor tracker reports CSS-px positions
// relative to the canvas; its `current()` is read when the camera changes
// (so the HUD world-coords stay in sync without a redraw).
const hud = createHud();
const cursor = createCursorTracker(host.canvas, (pos) => {
  hud.update(store.get(), pos);
});
hud.update(store.get(), null);

// Camera changes → re-render (on-demand, D-10) and HUD refresh.
store.subscribe((cam) => {
  host.requestRender();
  hud.update(cam, cursor.current());
});

// Camera input (wheel, keyboard, pointer) pushes new cameras into the store.
const input = attachCameraInput({
  canvas: host.canvas,
  store,
  getViewportSize: () => ({
    width: host.canvas.clientWidth,
    height: host.canvas.clientHeight,
  }),
});

// Initial paint — renders on demand, never in a continuous loop (D-10).
host.requestRender();

// Keep the input reference so listeners live for the page lifetime. Detach
// is only needed for HMR or explicit teardown, neither of which exists yet.
void input;
