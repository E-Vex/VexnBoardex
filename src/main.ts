// VexBoard entry point (T-005 / T-007 R10): wires the camera store, the doc
// store, the board renderer, the cursor tracker, the HUD, camera input
// (pan/zoom) and node input (double-click creates a card). Camera and
// document changes flow through their stores, each triggering a re-render
// and a HUD update.
import './style.css';
import { emptyDoc } from './core/doc';
import { createDocStore } from './core/store';
import { attachCameraInput } from './input/cameraInput';
import { createCursorTracker } from './input/cursor';
import { attachNodeInput } from './input/nodeInput';
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

// The doc store is the single source of truth for the document (T-007 R10,
// I-03): every mutation goes through dispatch.
const docStore = createDocStore(emptyDoc());

// Canvas host: the render callback reads the current camera and document.
const host = createCanvasHost(({ ctx, width, height }) => {
  renderBoard(ctx, { width, height }, store.get(), docStore.get());
});

// HUD overlay + cursor tracker. The cursor tracker reports CSS-px positions
// relative to the canvas; its `current()` is read when the camera changes
// (so the HUD world-coords stay in sync without a redraw).
const hud = createHud();
const cursor = createCursorTracker(host.canvas, (pos) => {
  hud.update(store.get(), pos, docStore.get().order.length);
});
hud.update(store.get(), null, docStore.get().order.length);

// Camera changes → re-render (on-demand, D-10) and HUD refresh. The HUD is
// also refreshed here so the node count stays current (T-007 R10).
store.subscribe((cam) => {
  host.requestRender();
  hud.update(cam, cursor.current(), docStore.get().order.length);
});

// Document changes → re-render and HUD refresh (T-007 R10).
docStore.subscribe((doc) => {
  host.requestRender();
  hud.update(store.get(), cursor.current(), doc.order.length);
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

// Node input: double-click creates a card at the cursor through
// docStore.dispatch (T-007 R8, I-03). IDs are generated here, outside
// core (D-11).
const nodeInput = attachNodeInput({
  canvas: host.canvas,
  cameraStore: store,
  docStore,
  newId: () => crypto.randomUUID(),
});

// Initial paint — renders on demand, never in a continuous loop (D-10).
host.requestRender();

// Keep the input references so listeners live for the page lifetime. Detach
// is only needed for HMR or explicit teardown, neither of which exists yet.
void input;
void nodeInput;
