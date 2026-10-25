// VexBoard entry point (T-005 / T-007 R10 / T-008 R7 / T-011 R4 / T-013 R1 / T-018):
// wires the camera store, the doc store, the UI store (selection + drag /
// connect previews, D-25), the board renderer, the cursor tracker, the HUD,
// camera input (pan/zoom), node input (double-click creates a card, selects
// it), select input (select, move, delete), connect input (drag from handle
// to create edge), and IO (autosave with startup restore, file
// export/import). Camera, document and UI changes flow through their
// stores, each triggering a re-render and a HUD update.
import './style.css';
import type { Node, Edge, Doc } from './core/types';
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
import { createAutosaver, loadAutosave, clearAutosave } from './io/autosave';
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

// --- Autosave (T-013, T-018) ---
// Create autosaver that saves on every doc/view change.
const autosaver = createAutosaver();

// Restore the last autosaved session on startup (T-018: reload keeps your
// work — M4's "save → reload → deep-equal document" promise, in-app).
// Runs after the first paint; subscribers refresh the HUD and canvas.
void (async () => {
  try {
    const saved = await loadAutosave();
    if (saved) {
      docStore.replace(saved.envelope.doc);
      uiStore.setSelection([]);
      if (saved.envelope.view) {
        store.set({
          x: saved.envelope.view.x,
          y: saved.envelope.view.y,
          zoom: saved.envelope.view.zoom,
        });
      }
      for (const w of saved.warnings) console.warn('[restore]', w);
    }
  } catch (e) {
    console.warn('[restore] autosave unavailable:', e);
  }
})();

// Flush pending autosaves when the page goes away (debounce would lose them).
window.addEventListener('pagehide', () => {
  void autosaver.flush();
});

// Subscribe to document changes → autosave.
docStore.subscribe((doc) => {
  autosaver.update(doc, store.get());
});

// Subscribe to camera changes → autosave (view).
store.subscribe((cam) => {
  autosaver.update(docStore.get(), cam);
});

// --- Clipboard for copy/paste (T-016) ---
interface ClipboardData {
  nodes: Node[];
  edges: Edge[];
}
let clipboard: ClipboardData | null = null;

// --- Keyboard shortcuts (T-015, T-016) ---
// Ctrl+Z = undo, Ctrl+Y/Ctrl+Shift+Z = redo.
// Ctrl+C = copy, Ctrl+V = paste, Ctrl+D = duplicate.
// Ctrl+A = select all.
// Ctrl+Shift+Up/Down = bring to front / send to back.
// Arrow keys = nudge (handled in selectTool).
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const isMac = navigator.platform.includes('Mac');
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const shift = e.shiftKey;

  if (mod) {
    switch (e.key.toLowerCase()) {
      case 'z':
        if (shift) {
          e.preventDefault();
          docStore.redo();
        } else {
          e.preventDefault();
          docStore.undo();
        }
        break;
      case 'y':
        e.preventDefault();
        docStore.redo();
        break;
      case 'c':
        e.preventDefault();
        copySelection();
        break;
      case 'v':
        e.preventDefault();
        pasteSelection();
        break;
      case 'd':
        e.preventDefault();
        duplicateSelection();
        break;
      case 'a':
        e.preventDefault();
        selectAll();
        break;
      case 'arrowup':
        if (shift) {
          e.preventDefault();
          bringToFront();
        }
        break;
      case 'arrowdown':
        if (shift) {
          e.preventDefault();
          sendToBack();
        }
        break;
    }
  }
});

function copySelection(): void {
  const selection = uiStore.get().selection;
  if (selection.length === 0) return;
  const doc = docStore.get();
  const nodes = selection
    .map((id) => doc.nodes[id])
    .filter((n): n is Node => !!n)
    .map((n) => ({ ...n }));
  // Include edges between selected nodes.
  const edges = getSelectedEdges(doc, selection).map((e) => ({ ...e }));
  clipboard = { nodes, edges };
}

function getSelectedEdges(doc: Doc, selection: string[]): Edge[] {
  const edges: Edge[] = [];
  for (const [, edge] of Object.entries(doc.edges)) {
    if (selection.includes(edge.from.node) && selection.includes(edge.to.node)) {
      edges.push(edge);
    }
  }
  return edges;
}

function duplicateNodes(ids: string[]): void {
  if (ids.length === 0) return;
  const newIds = ids.map(() => crypto.randomUUID());
  const doc = docStore.get();
  const edgeCount = getSelectedEdges(doc, ids).length;
  const newEdgeIds = Array.from({ length: edgeCount }, () => crypto.randomUUID());
  docStore.dispatch({
    type: 'node.duplicate',
    ids,
    offsetX: 20,
    offsetY: 20,
    newIds,
    newEdgeIds,
  });
}

function pasteSelection(): void {
  if (!clipboard || clipboard.nodes.length === 0) return;
  duplicateNodes(clipboard.nodes.map((n) => n.id));
}

function duplicateSelection(): void {
  duplicateNodes(uiStore.get().selection);
}

function selectAll(): void {
  const doc = docStore.get();
  const allIds = Object.keys(doc.nodes);
  if (allIds.length > 0) {
    uiStore.setSelection(allIds);
  }
}

function bringToFront(): void {
  const selection = uiStore.get().selection;
  if (selection.length === 0) return;
  docStore.dispatch({ type: 'node.zOrder', ids: selection, mode: 'front' });
}

function sendToBack(): void {
  const selection = uiStore.get().selection;
  if (selection.length === 0) return;
  docStore.dispatch({ type: 'node.zOrder', ids: selection, mode: 'back' });
}

// Toolbar for export/import + edit actions (T-13 R2, T-016).
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
    flex-wrap: wrap;
  `;

  type ButtonConfig = {
    text: string;
    onClick: () => void;
    isDisabled?: () => boolean;
  };

  const buttons: { element: HTMLButtonElement; config: ButtonConfig }[] = [];

  const makeBtn = (config: ButtonConfig) => {
    const btn = document.createElement('button');
    btn.textContent = config.text;
    btn.style.cssText = 'padding: 6px 12px; font-size: 13px; cursor: pointer;';
    btn.disabled = config.isDisabled ? config.isDisabled() : false;
    btn.onclick = config.onClick;
    buttons.push({ element: btn, config });
    toolbar.appendChild(btn);
  };

  makeBtn({ text: '↶ Undo', onClick: () => docStore.undo(), isDisabled: () => !docStore.canUndo() });
  makeBtn({ text: '↷ Redo', onClick: () => docStore.redo(), isDisabled: () => !docStore.canRedo() });
  makeBtn({ text: 'Copy', onClick: copySelection, isDisabled: () => uiStore.get().selection.length === 0 });
  makeBtn({ text: 'Paste', onClick: pasteSelection, isDisabled: () => !clipboard || clipboard.nodes.length === 0 });
  makeBtn({ text: 'Duplicate', onClick: duplicateSelection, isDisabled: () => uiStore.get().selection.length === 0 });
  makeBtn({ text: 'Select All', onClick: selectAll, isDisabled: () => docStore.get().order.length === 0 });
  makeBtn({ text: 'Front', onClick: bringToFront, isDisabled: () => uiStore.get().selection.length === 0 });
  makeBtn({ text: 'Back', onClick: sendToBack, isDisabled: () => uiStore.get().selection.length === 0 });
  makeBtn({ text: 'Export', onClick: () => exportFile(docStore.get(), store.get()) });
  makeBtn({
    text: 'Import',
    onClick: async () => {
      const file = await pickFile();
      if (file) {
        try {
          const result = await importFile(file);
          // T-018: the imported document actually replaces the current one.
          docStore.replace(result.envelope.doc);
          uiStore.setSelection([]);
          if (result.envelope.view) {
            store.set({
              x: result.envelope.view.x,
              y: result.envelope.view.y,
              zoom: result.envelope.view.zoom,
            });
          }
          for (const w of result.warnings) console.warn('[import]', w);
        } catch (e) {
          console.error('[import] failed:', e);
        }
      }
    },
  });
  makeBtn({
    // T-018: New board — replaces the document and clears the autosave so a
    // reload does not resurrect the old board.
    text: 'New',
    onClick: () => {
      docStore.replace(emptyDoc());
      uiStore.setSelection([]);
      void clearAutosave();
    },
  });

  const updateToolbar = () => {
    for (const { element, config } of buttons) {
      if (config.isDisabled) {
        element.disabled = config.isDisabled();
      }
    }
  };

  docStore.subscribe(updateToolbar);
  uiStore.subscribe(updateToolbar);

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
