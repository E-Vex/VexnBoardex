/**
 * In-place text editor overlay (T-020, M7) — a DOM `<textarea>` over the
 * canvas (PLAN D-02) for editing a node's text with full IME, selection and
 * multiline support for free.
 *
 * Invariants honored:
 * - I-10: the overlay's position and scale derive from the SAME camera as
 *   the canvas (`worldToScreen` + CSS `scale(zoom)` with transform-origin at
 *   the node's top-left screen point); it repositions on every camera change
 *   while open.
 * - I-03/I-04: typing never touches the document; ONE `node.update` command
 *   is dispatched on commit (blur or Ctrl/⌘+Enter). Escape cancels with no
 *   command.
 * - D-27 (never steal typing): while the editor is open it IS the editable
 *   target, so the app's own key handlers (delete, shortcuts) stand down —
 *   they all check `isEditableTarget`.
 *
 * The renderer skips the edited node's text while the overlay is open
 * (`uiStore.setEditing(id)`), so text is never drawn twice.
 */

import type { Id } from '../core/types';
import type { DocStore } from '../core/store';
import { worldToScreen } from '../view/camera';
import type { CameraStore } from '../view/cameraStore';
import type { UiStore } from '../view/uiStore';
import {
  FONT_STACK,
  NODE_PADDING,
  NODE_TEXT_COLOR,
  TEXT_NODE_COLOR,
} from '../view/theme';

/** The overlay's exported id, so e2e tests can find it (black box). */
export const TEXT_EDITOR_ID = 'vex-text-editor';

export interface TextEditorOptions {
  cameraStore: CameraStore;
  docStore: DocStore;
  uiStore: UiStore;
  /** The parent element for the overlay (default: document.body). */
  parent?: HTMLElement;
}

export interface TextEditor {
  /** Open the editor on a node (no-op when the node does not exist). */
  edit(nodeId: Id): void;
  /** True when the editor is open. */
  isOpen(): boolean;
  /** Close without committing. */
  cancel(): void;
  /** Commit (if the text changed) and close. */
  commit(): void;
  destroy(): void;
}

/** Create the overlay editor. Exactly one should exist per app. */
export function createTextEditor(
  opts: TextEditorOptions,
): TextEditor {
  const { cameraStore, docStore, uiStore, parent = document.body } = opts;

  let editingId: Id | null = null;
  let suppressBlurCommit = false;

  // The overlay container is sized/positioned in screen space; the textarea
  // inside is laid out at zoom-1 metrics and scaled with a CSS transform, so
  // the text metrics match the canvas renderer exactly at any zoom.
  const host = document.createElement('div');
  host.id = 'vex-text-editor-host';
  host.style.cssText = 'position: fixed; left: 0; top: 0; z-index: 50;';

  const area = document.createElement('textarea');
  area.id = TEXT_EDITOR_ID;
  area.spellcheck = false;
  area.style.cssText = [
    'display: block',
    'margin: 0',
    'padding: 0',
    'border: none',
    'outline: none',
    'resize: none',
    'overflow: hidden',
    'white-space: pre-wrap',
    'word-break: break-word',
    `font-family: ${FONT_STACK}`,
    'background: transparent',
  ].join('; ');
  host.appendChild(area);
  host.style.display = 'none';
  parent.appendChild(host);

  /** Position and scale the overlay from the current camera (I-10). */
  function place(): void {
    if (editingId === null) return;
    const node = docStore.get().nodes[editingId];
    if (!node) return;
    const cam = cameraStore.get();
    const topLeft = worldToScreen(cam, { x: node.x, y: node.y });
    host.style.transformOrigin = `${topLeft.x}px ${topLeft.y}px`;
    host.style.transform = `scale(${cam.zoom})`;
    host.style.left = `${topLeft.x}px`;
    host.style.top = `${topLeft.y}px`;
    // Layout at zoom-1 metrics; the transform scales it on screen.
    area.style.width = `${node.w}px`;
    area.style.height = `${node.h}px`;
    area.style.padding = `${NODE_PADDING}px`;
    area.style.fontSize = '16px';
    area.style.lineHeight = '1.3';
    area.style.color =
      node.kind === 'text' ? TEXT_NODE_COLOR : NODE_TEXT_COLOR;
    // Cards and stickies show their own fill behind the text; text nodes
    // stay transparent so the board shows through, exactly like the renderer.
    area.style.background =
      node.kind === 'text' ? 'transparent' : node.color;
    area.style.borderRadius = '4px';
  }

  function open(nodeId: Id): void {
    const node = docStore.get().nodes[nodeId];
    if (!node) return;
    if (editingId !== null) {
      // Commit the previous editor before switching.
      commit();
    }
    editingId = nodeId;
    uiStore.setEditing(nodeId);
    area.value = node.text;
    host.style.display = 'block';
    place();
    area.focus();
    area.select();
  }

  function close(): void {
    if (editingId === null) return;
    editingId = null;
    suppressBlurCommit = true;
    // Release focus deterministically before hiding, so the very next
    // keystroke targets the page (not the detached textarea) — Escape then
    // Backspace must never be swallowed by a half-closed editor.
    area.blur();
    host.style.display = 'none';
    area.value = '';
    uiStore.setEditing(null);
    window.setTimeout(() => {
      suppressBlurCommit = false;
    }, 0);
  }

  function commit(): void {
    if (editingId === null) return;
    const id = editingId;
    const node = docStore.get().nodes[id];
    if (node && area.value !== node.text) {
      docStore.dispatch({
        type: 'node.update',
        ids: [id],
        patch: { text: area.value },
      });
    }
    close();
  }

  // Blur (clicking anywhere outside) commits — the standard whiteboard UX.
  area.addEventListener('blur', () => {
    if (suppressBlurCommit) return;
    commit();
  });

  area.addEventListener('keydown', (e) => {
    // Escape cancels without a command (D-26-style cancel semantics).
    if (e.key === 'Escape') {
      e.preventDefault();
      suppressBlurCommit = true;
      close();
      return;
    }
    // Ctrl/⌘+Enter commits; plain Enter is a newline (multiline text).
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit();
    }
    // Stop the event from reaching the window handlers (they also check
    // isEditableTarget, but stopping propagation keeps things predictable).
    e.stopPropagation();
  });

  // Reposition while the camera moves (pan/zoom under an open editor).
  cameraStore.subscribe(() => {
    if (editingId !== null) place();
  });

  // The node's own geometry can change while editing (resize preview):
  // re-place on document changes too.
  docStore.subscribe(() => {
    if (editingId !== null) place();
  });

  return {
    edit: open,
    isOpen: () => editingId !== null,
    cancel: () => {
      suppressBlurCommit = true;
      close();
    },
    commit,
    destroy() {
      host.remove();
    },
  };
}
