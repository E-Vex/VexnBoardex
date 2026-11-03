/**
 * Mind-map keyboard input (T-029, M9) — DOM glue.
 *
 * In `mindmap` mode only (the mode lives in the UI store, D-14/I-05):
 * - **Tab** grows a child of the single selected node; on an empty board it
 *   plants the root at the viewport centre. One batch command → one undo
 *   step (node + edge together).
 * - **Enter** grows a sibling of the single selected node.
 *
 * The new node is selected and its text editor opens immediately — the
 * mind-map cadence is key → type → commit, never a mouse trip. Stands down
 * for editable targets (D-27) and for any modified key.
 *
 * The typing cadence (T-030): a plain Enter/Tab pressed WHILE the editor is
 * open on a node is claimed via `claimEditorNavKey` — the typed text is
 * committed first (one `node.update`), then Enter grows a sibling and Tab a
 * child of the just-committed node, and the editor reopens on the new node.
 * Type → Enter → type → Enter… builds a map without touching the mouse.
 */

import type { Command, Id } from '../core/types';
import type { DocStore } from '../core/store';
import { screenToWorld } from '../view/camera';
import type { CameraStore } from '../view/cameraStore';
import type { UiStore } from '../view/uiStore';
import { isEditableTarget } from './keys';
import { planChild, planRoot, planSibling } from './mindmap';

export interface MindMapInputOptions {
  docStore: DocStore;
  uiStore: UiStore;
  cameraStore: CameraStore;
  /** Viewport size in CSS px (for planting the root at the centre). */
  getViewportSize: () => { width: number; height: number };
  /** Fresh entity ids, generated outside core (D-11). */
  newId: () => Id;
  /** Open the text editor on the freshly created node. */
  editNode: (id: Id) => void;
  /**
   * Commit the open text editor, if any (T-030 typing cadence). Called
   * before a claimed Enter/Tab grows the tree, so the typed text is in the
   * document first — undo un-grows before it un-types.
   */
  commitEditor: () => void;
}

export interface MindMapInput {
  detach(): void;
  /**
   * The typing cadence (T-030): claim a plain Enter or Tab pressed while
   * the text editor is open on `nodeId`. Commits the text first (one
   * `node.update`, dispatched only when it changed), then grows a sibling
   * (Enter) or a child (Tab) — one batch, one undo step — and opens the
   * editor on the new node. Returns false when mind-map mode is off or the
   * node is gone, so the editor keeps its default behavior.
   */
  claimEditorNavKey(key: 'Enter' | 'Tab', nodeId: Id): boolean;
}

/**
 * Attach the mind-map key handlers to `window`. Exactly one instance per
 * app; detach on teardown.
 */
export function attachMindMapInput(opts: MindMapInputOptions): MindMapInput {
  const { docStore, uiStore, cameraStore } = opts;

  /** Dispatch a plan, select the new node and open the editor on it. */
  function grow(nodeId: Id, command: Command): void {
    docStore.dispatch(command);
    if (docStore.get().nodes[nodeId]) {
      uiStore.setSelection([nodeId]);
      opts.editNode(nodeId);
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    // Never steal typing (D-27); mind-map keys are unmodified only.
    if (isEditableTarget(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (uiStore.get().mode !== 'mindmap') return;

    const doc = docStore.get();
    const selection = uiStore.get().selection;
    const selectedId = selection.length === 1 ? selection[0] : undefined;
    // The single selected node, when it still exists in the document.
    const selected =
      selectedId !== undefined && doc.nodes[selectedId] !== undefined
        ? selectedId
        : null;

    if (e.key === 'Tab') {
      if (selected !== null) {
        e.preventDefault();
        const id = opts.newId();
        grow(id, planChild(doc, selected, id, opts.newId()));
      } else if (selection.length === 0 && doc.order.length === 0) {
        // Empty board: plant the root at the viewport centre (I-02 — the
        // only screen→world conversion is view/camera's).
        e.preventDefault();
        const { width, height } = opts.getViewportSize();
        const world = screenToWorld(cameraStore.get(), {
          x: width / 2,
          y: height / 2,
        });
        const id = opts.newId();
        grow(id, planRoot(world, id));
      }
      return;
    }

    if (e.key === 'Enter') {
      if (selected !== null) {
        e.preventDefault();
        const id = opts.newId();
        grow(id, planSibling(doc, selected, id, opts.newId()));
      }
    }
  }

  /**
   * The typing cadence (T-030), claimed from the open text editor: commit
   * the typed text first (the editor does it — one `node.update`, only
   * when the text really changed), then plan the growth from the COMMITTED
   * document and hand the editor to the new node. The plain key never
   * reaches the textarea's default behavior (newline / focus move).
   */
  function claimEditorNavKey(key: 'Enter' | 'Tab', nodeId: Id): boolean {
    if (uiStore.get().mode !== 'mindmap') return false;
    // The typed text lands in the document BEFORE the grow, so undo walks
    // the steps back in the natural order: un-grow first, un-type second.
    opts.commitEditor();
    const doc = docStore.get();
    if (doc.nodes[nodeId] === undefined) return false;
    const id = opts.newId();
    const command =
      key === 'Tab'
        ? planChild(doc, nodeId, id, opts.newId())
        : planSibling(doc, nodeId, id, opts.newId());
    grow(id, command);
    return true;
  }

  window.addEventListener('keydown', onKeyDown);
  return {
    detach() {
      window.removeEventListener('keydown', onKeyDown);
    },
    claimEditorNavKey,
  };
}
