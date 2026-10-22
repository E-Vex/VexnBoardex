// VexBoard entry point (T-005 / T-007 R10 / T-008 R7 / T-011 R4 / T-013 R1):
// wires the camera store, the doc store, the UI store (selection + drag
// preview, D-25), the board renderer, the cursor tracker, the HUD, camera
// input (pan/zoom), node input (double-click creates a card, selects it),
// select input (select, move, delete), connect input (drag from handle to
// create edge), and IO (autosave, file export/import).
// Camera, document and UI changes flow through their stores, each triggering
// a re-render and a HUD update.
import './style.css';
import { emptyDoc } from './core/doc';
import { createDocStore } from './core/store';
import { attachCameraInput } from './input/cameraInput';
import { createCursorTracker } from './input/cursor';
import { attachNodeInput } from './input/nodeInput';
import { attachSelectInput } from './input/selectInput';
import { attachConnectInput } from './input/connectInput';
import { createHud } from './ui/hud';
import { cameraCenteredOn } from './view/camera';
import { createCameraStore } from './view/cameraStore';
import { createCanvasHost } from './view/canvasHost';
import { renderBoard } from './view/renderer';
import { createUiStore, pruneSelection } from './view/uiStore';
import { createAutosaver } from './io/autosave';
import { exportFile, importFile, pickFile } from './io/file';

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
const docStore = createDocStore(emptyDoc(), { now: () => Date.now() });

// The UI store is the single source of truth for selection and the drag
// preview (T-008 R7, D-25). Never saved, never in history (I-05).
const uiStore = createUiStore();

// Canvas host: the render callback reads the current camera, document and
// UI state (T-008 R7) — the renderer is a pure function of all three
// (D-10, D-25).
const host = createCanvasHost(({ ctx, width, height }) => {
  renderBoard(
    ctx,
    { width, height },
    store.get(),
    docStore.get(),
    uiStore.get(),
  );
});

// HUD overlay + cursor tracker. The cursor tracker reports CSS-px positions
// relative to the canvas; its `current()` is read when the camera changes
// (so the HUD world-coords stay in sync without a redraw).
const hud = createHud();

/** Refresh every HUD line from the three stores (T-008 R7). */
function refreshHud(): void {
  hud.update(
    store.get(),
    cursor.current(),
    docStore.get().order.length,
    uiStore.get().selection.length,
    docStore.getRevision(),
  );
}

const cursor = createCursorTracker(host.canvas, () => {
  refreshHud();
});
refreshHud();

// Camera changes → re-render (on-demand, D-10) and HUD refresh.
store.subscribe(() => {
  host.requestRender();
  refreshHud();
});

// Document changes → prune the selection to existing ids (D-27), re-render
// and HUD refresh. Pruning first, so the HUD never shows a stale count.
docStore.subscribe((doc) => {
  const selection = uiStore.get().selection;
  const pruned = pruneSelection(selection, doc);
  if (pruned !== selection) {
    uiStore.setSelection(pruned);
  }
  host.requestRender();
  refreshHud();
});

// UI state changes (selection, drag preview) → re-render and HUD refresh
// (T-008 R7): the drag preview must appear while the pointer moves.
uiStore.subscribe(() => {
  host.requestRender();
  refreshHud();
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

// Connect input: drag from a handle to create an edge (T-011 R4).
// Stands down when panning is active (D-26).
const connectInput = attachConnectInput({
  canvas: host.canvas,
  cameraStore: store,
  docStore,
  uiStore,
  isPanActive: () => input.isPanning() || input.isSpaceHeld(),
});

// --- Autosave (T-013) ---
// Create autosaver that saves on every doc/view change.
const autosaver = createAutosaver();

// Subscribe to document changes → autosave.
docStore.subscribe((doc) => {
  autosaver(doc, store.get());
});

// Subscribe to camera changes → autosave (view).
store.subscribe((cam) => {
  autosaver(docStore.get(), cam);
});

// --- Undo/Redo keyboard shortcuts (T-015) ---
// Ctrl+Z = undo, Ctrl+Y / Ctrl+Shift+Z = redo.
// Ignore when typing in inputs (D-27).
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      docStore.undo();
    } else if ((e.key === 'y') || (e.key === 'z' && e.shiftKey)) {
      e.preventDefault();
      docStore.redo();
    }
  }
});

// Toolbar for export/import + undo/redo (T-13 R2, T-015 R3).
function createToolbar(): void {
  const toolbar = document.createElement('div');
  toolbar.id = 'vex-toolbar';
  toolbar.style.cssText = `
    position: fixed;
    top: 12px;
    left: 12px;
    display: flex;
    gap: 8px;
    z-index: 100;
    font-family: system-ui, sans-serif;
    align-items: center;
  `;

  const undoBtn = document.createElement('button');
  undoBtn.textContent = '↶ Undo';
  undoBtn.style.cssText = 'padding: 6px 12px; font-size: 13px; cursor: pointer;';
  undoBtn.disabled = !docStore.canUndo();
  undoBtn.onclick = () => docStore.undo();

  const redoBtn = document.createElement('button');
  redoBtn.textContent = '↷ Redo';
  redoBtn.style.cssText = 'padding: 6px 12px; font-size: 13px; cursor: pointer;';
  redoBtn.disabled = !docStore.canRedo();
  redoBtn.onclick = () => docStore.redo();

  const exportBtn = document.createElement('button');
  exportBtn.textContent = 'Export';
  exportBtn.style.cssText = 'padding: 6px 12px; font-size: 13px; cursor: pointer;';
  exportBtn.onclick = () => exportFile(docStore.get(), store.get());

  const importBtn = document.createElement('button');
  importBtn.textContent = 'Import';
  importBtn.style.cssText = 'padding: 6px 12px; font-size: 13px; cursor: pointer;';
  importBtn.onclick = async () => {
    const file = await pickFile();
    if (file) {
      const result = await importFile(file);
      console.log('[import]', result);
      for (const w of result.warnings) console.warn('[import]', w);
    }
  };

  // Update button states on doc changes.
  docStore.subscribe(() => {
    undoBtn.disabled = !docStore.canUndo();
    redoBtn.disabled = !docStore.canRedo();
  });

  toolbar.appendChild(undoBtn);
  toolbar.appendChild(redoBtn);
  toolbar.appendChild(exportBtn);
  toolbar.appendChild(importBtn);
  document.body.appendChild(toolbar);
}
createToolbar();

// Initial paint — renders on demand, never in a continuous loop (D-10).
host.requestRender();

// Keep the input references so listeners live for the page lifetime. Detach
// is only needed for HMR or explicit teardown, neither of which exists yet.
void input;
void nodeInput;
void selectInput;
void connectInput;
