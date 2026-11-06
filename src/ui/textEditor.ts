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
import {
  columnRect,
  KANBAN_CHEVRON_SLOT,
  KANBAN_HEADER_H,
  KANBAN_PADDING,
} from '../core/kanban';
import { worldToScreen } from '../view/camera';
import type { CameraStore } from '../view/cameraStore';
import type { UiStore } from '../view/uiStore';
import {
  KANBAN_COLUMN_FILL,
  KANBAN_HEADER_COLOR,
  FONT_SIZE,
  FONT_STACK,
  LINE_HEIGHT,
  NODE_PADDING,
  NODE_TEXT_COLOR,
  ROUNDED_SHAPE_RADIUS,
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
  /**
   * Claim navigation keys while editing (T-030, mind-map typing cadence).
   * Called with the key ('Enter' | 'Tab') and the id of the node being
   * edited, BEFORE the default behavior runs — Enter inserts a newline,
   * Tab moves focus away (which commits via blur). Modified keys and keys
   * during IME composition are never offered. Return true to claim the
   * key: no default behavior runs and the editor does nothing else —
   * committing the text, growing the tree and reopening the editor are
   * the claimer's job.
   */
  onNavKey?: (key: 'Enter' | 'Tab', nodeId: Id) => boolean;
}

export interface TextEditor {
  /** Open the editor on a node (no-op when the node does not exist). */
  edit(nodeId: Id): void;
  /**
   * Open the editor on a KANBAN COLUMN's name (T-037): the same overlay,
   * positioned over the column's header strip, committing ONE `group.update`
   * on blur or Enter (a name is one line — Enter commits, never a newline).
   * No-op when the group does not exist.
   */
  editColumn(groupId: Id): void;
  /** True when the editor is open (a node or a column name). */
  isOpen(): boolean;
  /** Close without committing. */
  cancel(): void;
  /** Commit (if the text changed) and close. */
  commit(): void;
  destroy(): void;
}

/** Create the overlay editor. Exactly one should exist per app. */
export function createTextEditor(opts: TextEditorOptions): TextEditor {
  const { cameraStore, docStore, uiStore, parent = document.body } = opts;

  let editingId: Id | null = null;
  /** The kanban column whose name is being edited (T-037), or null. At most
   * one of `editingId` / `editingColumnId` is ever set — the same single
   * textarea serves both. */
  let editingColumnId: Id | null = null;
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
    if (editingId === null && editingColumnId === null) return;
    if (editingColumnId !== null) {
      // T-037: over the column's header strip — the same rect the canvas
      // renderer writes the name into (inset by the padding, the chevron
      // slot and the × zone reserved — T-039 shifted the name right of the
      // chevron), so the editing view and the committed result agree.
      const group = docStore.get().groups[editingColumnId];
      if (!group) return;
      const rect = columnRect(group);
      if (rect === null) return;
      const cam = cameraStore.get();
      const topLeft = worldToScreen(cam, {
        x: rect.x + KANBAN_PADDING + KANBAN_CHEVRON_SLOT,
        y: rect.y,
      });
      host.style.transformOrigin = `${topLeft.x}px ${topLeft.y}px`;
      host.style.transform = `scale(${cam.zoom})`;
      host.style.left = `${topLeft.x}px`;
      host.style.top = `${topLeft.y}px`;
      area.style.width = `${Math.max(
        24,
        rect.w - 2 * KANBAN_PADDING - KANBAN_CHEVRON_SLOT - 24,
      )}px`;
      area.style.height = `${KANBAN_HEADER_H}px`;
      area.style.borderRadius = '0px';
      area.style.clipPath = '';
      area.style.padding = '0px';
      area.style.fontSize = '15px';
      area.style.fontWeight = '600';
      area.style.lineHeight = `${KANBAN_HEADER_H}px`; // one line, centred
      area.style.color = KANBAN_HEADER_COLOR;
      area.style.background = KANBAN_COLUMN_FILL;
      return;
    }
    if (editingId === null) return;
    const node = docStore.get().nodes[editingId];
    if (!node) return;
    const cam = cameraStore.get();
    const topLeft = worldToScreen(cam, { x: node.x, y: node.y });
    host.style.transformOrigin = `${topLeft.x}px ${topLeft.y}px`;
    host.style.transform = `scale(${cam.zoom})`;
    host.style.left = `${topLeft.x}px`;
    host.style.top = `${topLeft.y}px`;
    // Layout at zoom-1 metrics; the transform scales it on screen. The font
    // metrics come from the same theme constants the canvas renderer uses
    // (T-020: the overlay's text must match the rendered text exactly at any
    // zoom — hardcoding the numbers here would silently drift when the
    // theme changes).
    area.style.width = `${node.w}px`;
    area.style.height = `${node.h}px`;
    // The overlay mirrors the node's outline (T-032): rounded and stadium
    // get their radius, the diamond is clipped to its outline and its text
    // box inset to the inscribed rectangle — the same geometry the canvas
    // renderer uses, so the editing view matches the committed result.
    switch (node.shape) {
      case 'rounded':
        area.style.borderRadius = `${Math.min(
          ROUNDED_SHAPE_RADIUS,
          node.w / 2,
          node.h / 2,
        )}px`;
        area.style.clipPath = '';
        area.style.padding = `${NODE_PADDING}px`;
        break;
      case 'stadium':
        area.style.borderRadius = `${Math.min(node.w, node.h) / 2}px`;
        area.style.clipPath = '';
        area.style.padding = `${NODE_PADDING}px`;
        break;
      case 'diamond':
        area.style.borderRadius = '0px';
        area.style.clipPath = 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)';
        area.style.padding = `${node.h / 4 + NODE_PADDING}px ${
          node.w / 4 + NODE_PADDING
        }px`;
        break;
      case 'rect':
        area.style.borderRadius = '0px';
        area.style.clipPath = '';
        area.style.padding = `${NODE_PADDING}px`;
        break;
      default:
        // No explicit shape: the classic overlay (T-020).
        area.style.borderRadius = '4px';
        area.style.clipPath = '';
        area.style.padding = `${NODE_PADDING}px`;
    }
    area.style.fontSize = `${FONT_SIZE}px`;
    area.style.lineHeight = String(LINE_HEIGHT);
    area.style.color = node.kind === 'text' ? TEXT_NODE_COLOR : NODE_TEXT_COLOR;
    // Cards and stickies show their own fill behind the text; text nodes
    // stay transparent so the board shows through, exactly like the renderer.
    area.style.background = node.kind === 'text' ? 'transparent' : node.color;
  }

  function open(nodeId: Id): void {
    const node = docStore.get().nodes[nodeId];
    if (!node) return;
    if (editingColumnId !== null || editingId !== null) {
      // Commit the previous editor before switching.
      commit();
    }
    editingId = nodeId;
    editingColumnId = null;
    uiStore.setEditing(nodeId);
    uiStore.setEditingColumn(null);
    area.value = node.text;
    host.style.display = 'block';
    place();
    area.focus();
    area.select();
  }

  /** Open the editor on a column's header name (T-037). */
  function openColumn(groupId: Id): void {
    const group = docStore.get().groups[groupId];
    if (!group) return;
    if (editingId !== null || editingColumnId !== null) {
      commit();
    }
    editingColumnId = groupId;
    editingId = null;
    uiStore.setEditing(null);
    uiStore.setEditingColumn(groupId);
    area.value = group.name;
    host.style.display = 'block';
    place();
    area.focus();
    area.select();
  }

  function close(): void {
    if (editingId === null && editingColumnId === null) return;
    editingId = null;
    editingColumnId = null;
    suppressBlurCommit = true;
    // Release focus deterministically before hiding, so the very next
    // keystroke targets the page (not the detached textarea) — Escape then
    // Backspace must never be swallowed by a half-closed editor.
    area.blur();
    host.style.display = 'none';
    area.value = '';
    uiStore.setEditing(null);
    uiStore.setEditingColumn(null);
    window.setTimeout(() => {
      suppressBlurCommit = false;
    }, 0);
  }

  function commit(): void {
    if (editingId === null && editingColumnId === null) return;
    if (editingColumnId !== null) {
      // T-037: ONE group.update per commit — a rename is one undo step.
      const id = editingColumnId;
      const group = docStore.get().groups[id];
      if (group && area.value !== group.name) {
        docStore.dispatch({
          type: 'group.update',
          ids: [id],
          patch: { name: area.value },
        });
      }
      close();
      return;
    }
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
    // T-037: a column name is ONE line — any Enter commits it (never a
    // newline, and never a claimed nav key: the mind-map cadence owns node
    // editors only). IME confirmation is never stolen (D-27).
    if (editingColumnId !== null && e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      commit();
      return;
    }
    // T-030: a plain, unmodified Enter/Tab outside IME composition can be
    // claimed by the host (the mind-map typing cadence: commit the text,
    // grow the tree, reopen the editor on the new node). The claimer owns
    // the whole flow — the editor must not add a newline or blur-commit
    // on top of it. Modified keys (Ctrl/⌘/Alt/Shift) are never claimed, so
    // multiline text keeps Shift+Enter as a soft newline and Ctrl/⌘+Enter
    // as an explicit commit, and IME confirmation is never stolen (D-27).
    if (
      (e.key === 'Enter' || e.key === 'Tab') &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey &&
      !e.isComposing &&
      editingId !== null &&
      opts.onNavKey !== undefined &&
      opts.onNavKey(e.key, editingId)
    ) {
      e.preventDefault();
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
    if (editingId !== null || editingColumnId !== null) place();
  });

  // The node's own geometry can change while editing (resize preview):
  // re-place on document changes too.
  docStore.subscribe(() => {
    if (editingId !== null || editingColumnId !== null) place();
  });

  return {
    edit: open,
    editColumn: openColumn,
    isOpen: () => editingId !== null || editingColumnId !== null,
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
