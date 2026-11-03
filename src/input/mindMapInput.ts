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
}

export interface MindMapInput {
  detach(): void;
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

  window.addEventListener('keydown', onKeyDown);
  return {
    detach() {
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
