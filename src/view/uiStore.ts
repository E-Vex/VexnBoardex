/**
 * UI store (T-008 R3, D-25) — the UI state layer: selection and drag preview.
 *
 * Lives in `view/` (not `ui/`) on purpose (D-25): both the renderer (`view`)
 * and the input layer read it, and the dependency rule forbids `view` and
 * `input` from importing `ui/`. It is never saved and never in history (I-05)
 * — pruning history or the camera never sees it.
 *
 * Pure and DOM-free (PLAN D-06): an observable container like `cameraStore`,
 * nothing more. Values are treated as immutable: setters store the given
 * array/object as-is and notify subscribers only when the value really
 * changes.
 */

import type { Doc, Id } from '../core/types';
import type { Point } from '../core/geometry';

/**
 * A drag in progress (D-26): which nodes move and by how much, in **world**
 * units. A preview only — the document is untouched until pointer-up (I-04).
 */
export interface DragPreview {
  ids: Id[];
  dx: number;
  dy: number;
}

/**
 * A connection gesture in progress (T-018): the node/anchor being dragged
 * from and the current world-space endpoint under the cursor. Kept separate
 * from `DragPreview` so a connect gesture can never be mistaken for a node
 * drag (the renderer used to offset the from-node by the cursor's absolute
 * world position). Preview only — the document is untouched (I-04).
 */
export interface ConnectPreview {
  fromNode: Id;
  fromAnchor: 'top' | 'right' | 'bottom' | 'left';
  to: Point;
}

/** A box-select marquee rectangle in screen coordinates (T-016). */
export interface BoxSelectRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A resize preview rect for one node, in world coordinates (T-021). */
export interface ResizePreview {
  id: Id;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The UI state layer (D-25): selection ids, the active previews, the node
 * being text-edited and the box-select rect. */
export interface UiState {
  selection: Id[];
  drag: DragPreview | null;
  connect: ConnectPreview | null;
  /** The node being text-edited in the DOM overlay (T-020). */
  editing: Id | null;
  /** A resize gesture preview (T-021). */
  resize: ResizePreview | null;
  boxSelect: BoxSelectRect | null;
}

export interface UiStore {
  /** Returns the current UI state. */
  get(): UiState;
  /** Replace the selection. No notification when the ids are unchanged. */
  setSelection(ids: Id[]): void;
  /** Replace the drag preview (null = no drag). No notification when equal. */
  setDrag(drag: DragPreview | null): void;
  /** Replace the connect preview (null = no gesture). No notification when equal. */
  setConnect(connect: ConnectPreview | null): void;
  /** Set the node being text-edited (null = none). No notification when equal. */
  setEditing(id: Id | null): void;
  /** Replace the resize preview (null = no gesture). No notification when equal. */
  setResize(resize: ResizePreview | null): void;
  /** Replace the box-select rect (null = no box-select). No notification when equal. */
  setBoxSelect(rect: BoxSelectRect | null): void;
  /** Subscribe to UI state changes. Returns an unsubscribe function. */
  subscribe(fn: (state: UiState) => void): () => void;
}

/** True when two id arrays are element-wise equal in the same order. */
function sameIds(a: Id[], b: Id[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** True when two drag previews are equal (ids, dx and dy). */
function sameDrag(a: DragPreview | null, b: DragPreview | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.dx === b.dx && a.dy === b.dy && sameIds(a.ids, b.ids);
}

/** True when two connect previews are equal (node, anchor, endpoint). */
function sameConnect(
  a: ConnectPreview | null,
  b: ConnectPreview | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.fromNode === b.fromNode &&
    a.fromAnchor === b.fromAnchor &&
    a.to.x === b.to.x &&
    a.to.y === b.to.y
  );
}

/** True when two box-select rects are equal. */
function sameBoxSelect(a: BoxSelectRect | null, b: BoxSelectRect | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** True when two UI states are equal. */
function sameUiState(a: UiState, b: UiState): boolean {
  return (
    sameIds(a.selection, b.selection) &&
    sameDrag(a.drag, b.drag) &&
    sameConnect(a.connect, b.connect) &&
    a.editing === b.editing &&
    sameResize(a.resize, b.resize) &&
    sameBoxSelect(a.boxSelect, b.boxSelect)
  );
}

/** True when two resize previews are equal. */
function sameResize(a: ResizePreview | null, b: ResizePreview | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.id === b.id && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * Create a UI store initialised to all-empty UI state
 * `{ selection: [], drag: null, connect: null, editing: null, resize: null,
 *    boxSelect: null }`.
 */
export function createUiStore(): UiStore {
  let current: UiState = {
    selection: [],
    drag: null,
    connect: null,
    editing: null,
    resize: null,
    boxSelect: null,
  };
  const subscribers = new Set<(state: UiState) => void>();

  /** Replace one field, keeping the others (immutable state, I-05). */
  function patch(part: Partial<UiState>): void {
    const next: UiState = { ...current, ...part };
    if (sameUiState(next, current)) return;
    current = next;
    for (const fn of subscribers) {
      fn(current);
    }
  }

  return {
    get() {
      return current;
    },
    setSelection(ids: Id[]) {
      patch({ selection: ids });
    },
    setDrag(drag: DragPreview | null) {
      patch({ drag });
    },
    setConnect(connect: ConnectPreview | null) {
      patch({ connect });
    },
    setEditing(id: Id | null) {
      patch({ editing: id });
    },
    setResize(resize: ResizePreview | null) {
      patch({ resize });
    },
    setBoxSelect(rect: BoxSelectRect | null) {
      patch({ boxSelect: rect });
    },
    subscribe(fn: (state: UiState) => void): () => void {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
  };
}

/**
 * Prune a selection down to the ids that still exist in `doc` (T-008 R3,
 * D-27). Order is preserved. Pure: returns the input array itself when
 * nothing is pruned, a fresh array otherwise.
 */
export function pruneSelection(selection: Id[], doc: Doc): Id[] {
  const kept = selection.filter((id) =>
    Object.prototype.hasOwnProperty.call(doc.nodes, id),
  );
  return kept.length === selection.length ? selection : kept;
}
