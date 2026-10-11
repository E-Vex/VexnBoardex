// VexBoard entry point (T-005 / T-007 R10 / T-008 R7): wires the camera
// store, the doc store, the UI store (selection + drag preview, D-25), the
// board renderer, the cursor tracker, the HUD, camera input (pan/zoom),
// node input (double-click creates a card, selects it) and select input
// (select, move, delete). Camera, document and UI changes flow through
// their stores, each triggering a re-render and a HUD update.
import './style.css';
import { emptyDoc } from './core/doc';
import { createDocStore } from './core/store';
import { attachCameraInput } from './input/cameraInput';
import { createCursorTracker } from './input/cursor';
import { attachNodeInput } from './input/nodeInput';
import { attachSelectInput } from './input/selectInput';
import { createHud } from './ui/hud';
import { cameraCenteredOn } from './view/camera';
import { createCameraStore } from './view/cameraStore';
import { createCanvasHost } from './view/canvasHost';
import { renderBoard } from './view/renderer';
import { createUiStore } from './view/uiStore';

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

// The UI store is the single source of truth for selection and the drag
// preview (T-008 R7, D-25). Never saved, never in history (I-05).
const uiStore = createUiStore();

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

// Node input: double-click on empty space creates a card at the cursor
// through docStore.dispatch (T-007 R8, I-03) and selects it (T-008 D-28).
// IDs are generated here, outside core (D-11).
const nodeInput = attachNodeInput({
  canvas: host.canvas,
  cameraStore: store,
  docStore,
  uiStore,
  newId: () => crypto.randomUUID(),
});

// Select input: select, move and delete cards (T-008 R6). Space+left and
// middle-button drags belong to panning, so the select tool stands down
// whenever the camera input owns the pointer (D-26).
const selectInput = attachSelectInput({
  canvas: host.canvas,
  cameraStore: store,
  docStore,
  uiStore,
  isPanActive: () => input.isPanning() || input.isSpaceHeld(),
});

// Initial paint — renders on demand, never in a continuous loop (D-10).
host.requestRender();

// Keep the input references so listeners live for the page lifetime. Detach
// is only needed for HMR or explicit teardown, neither of which exists yet.
void input;
void nodeInput;
void selectInput;
