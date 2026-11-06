/**
 * Select input (T-008 R6, T-016) — DOM glue for the select tool state machine
 * (`selectTool.ts`). Converts pointer and keyboard events into machine
 * events and applies the emitted effects:
 *
 * - `select`  → `uiStore.setSelection`
 * - `setDrag` → `uiStore.setDrag`
 * - `dispatch`→ `docStore.dispatch` (I-03: the only mutation path)
 * - `setBoxSelect` → `uiStore.setBoxSelect` (for marquee preview)
 * - `selectInRect` → resolves the marquee rect against the document and
 *   sets the selection (T-017)
 *
 * T-035 (Kanban, data-driven — no mode): the glue rewrites DRAG effects
 * through the pure kanban planner. A single-card drag previews glued to its
 * slot while the card is over a column; the drag's pointer-up commit — a
 * `node.move` emitted by the machine, distinguishable from arrow-key nudges
 * by the pre-reduce mode — becomes the planner's ONE batch command (moves +
 * membership + source gap-closing) so a drop is ONE undo step (I-04). A
 * kanban card drags ALONE (`dragMembersOf`: the column is a container, not
 * a move-together unit), and a press on a column's × close affordance arms
 * a `group.delete` committed on release (D-26-style).
 *
 * T-037 (column interactions): a press on a column HEADER arms a column
 * move (drag past the threshold → the column AND its cards, one batch on
 * release; a plain click selects the members, the T-024 frame behaviour),
 * a press on a column's resize affordances arms a resize (preview-only
 * moves; ONE batch of `group.update` + re-fitted `node.resize`s on
 * release), and the kanban planner's target column is mirrored into the UI
 * store as the drop-target highlight while a card drag is in flight.
 *
 * Coordinate conversion goes through `view/camera` (I-02) and the shared
 * position helper; hit-testing through `core/hitTest`. Nothing starts while
 * a pan owns the pointer (`isPanActive`: Space held or actively panning —
 * D-26) or for touch pointers. Pointer capture is held only while a gesture
 * on a node is active.
 *
 * Delete/Backspace arrive via `keydown` on `window`: ignored for editable
 * targets and (per D-27) with modifier keys held; `Backspace` always
 * `preventDefault`s when the app owns it, so the browser never navigates
 * back.
 */

import {
  hitTestWithHandles,
  hitTestResizeHandles,
  groupFrameAt,
  edgeAt,
} from '../core/hitTest';
import {
  columnCloseHit,
  columnEffectiveRect,
  columnHeaderHit,
  columnResizeHit,
  columnResizeRect,
  dragMembersOf,
  planColumnMove,
  planColumnResize,
  planKanbanDrop,
  type ColumnResizeEdge,
} from '../core/kanban';
import { rectsIntersect } from '../core/geometry';
import type { Id } from '../core/types';
import type { DocStore } from '../core/store';
import { screenToWorld } from '../view/camera';
import type { CameraStore } from '../view/cameraStore';
import type { UiStore } from '../view/uiStore';
import { isEditableTarget } from './keys';
import { pointerToCanvasPos } from './cursor';
import { DRAG_THRESHOLD } from './selectTool';
import {
  type SelectCtx,
  type SelectEffect,
  type SelectEvent,
  type SelectState,
  initialSelectState,
  reduce,
} from './selectTool';

export interface SelectInputOptions {
  canvas: HTMLCanvasElement;
  cameraStore: CameraStore;
  docStore: DocStore;
  uiStore: UiStore;
  /** True while a pan gesture owns the pointer (Space held or panning). */
  isPanActive(): boolean;
}

export interface SelectInput {
  detach(): void;
}

/**
 * Attach select/move/delete/box-select input. Returns a `detach()` that removes
 * every listener and releases pointer capture.
 */
export function attachSelectInput(opts: SelectInputOptions): SelectInput {
  const { canvas, cameraStore, docStore, uiStore, isPanActive } = opts;

  let state: SelectState = initialSelectState();
  let capturedPointerId: number | null = null;
  /** An armed × close press (T-035): the column deletes on RELEASE — cancel
   * paths (cancel, blur, a drag past the threshold) dispatch nothing,
   * exactly like every other gesture (D-26). */
  let pendingClose: {
    pointerId: number;
    columnId: Id;
    screen: { x: number; y: number };
  } | null = null;

  /**
   * A column gesture in progress (T-037): a HEADER drag (move the column
   * and its cards) or an edge-handle drag (resize the stored rect, re-fit
   * the cards). Armed on press — outside the select machine, like the ×
   * close press — activated only after the DRAG_THRESHOLD (D-26), previewed
   * in the UI store on every move (I-04) and committed as ONE batch on
   * release. Cancel paths (Escape, pointercancel, blur, a plain click)
   * dispatch nothing.
   */
  interface ColumnGesture {
    pointerId: number;
    columnId: Id;
    kind: 'move' | 'resize';
    /** The gripped edge (resize only). */
    edge: ColumnResizeEdge;
    startScreen: { x: number; y: number };
    startWorld: { x: number; y: number };
    /** The column's effective rect at press — the resize anchor. */
    rect: { x: number; y: number; w: number; h: number };
    /** True once the threshold has been crossed. */
    active: boolean;
  }
  let columnGesture: ColumnGesture | null = null;
  /** Pointer capture held by a column gesture (its own, separate from the
   * machine's) so moves and the release keep arriving off-canvas too. */
  let columnCapturedPointer: number | null = null;

  /** Take pointer capture for the column gesture (best effort). */
  function captureColumnPointer(pointerId: number): void {
    if (columnCapturedPointer !== null) return;
    try {
      canvas.setPointerCapture(pointerId);
      columnCapturedPointer = pointerId;
    } catch {
      // The pointer may already be gone; the gesture still works while it
      // stays over the canvas.
    }
  }

  /** Release the column gesture's pointer capture. */
  function releaseColumnPointer(): void {
    if (columnCapturedPointer === null) return;
    try {
      canvas.releasePointerCapture(columnCapturedPointer);
    } catch {
      // Capture may already be released (e.g. after pointerup).
    }
    columnCapturedPointer = null;
  }

  /** End the column gesture: disarm, release the capture, clear the
   * previews. Exactly one of them was ever set. No command (D-26). */
  function endColumnGesture(): void {
    columnGesture = null;
    releaseColumnPointer();
    uiStore.setColumnDrag(null);
    uiStore.setColumnResize(null);
  }

  /** What a drag looked like BEFORE the reduce: at pointer-up the machine
   * resets to idle, so the pressed node (the kanban drop's primary card)
   * must be captured here (T-035). */
  interface DragCtx {
    /** The machine was mid-drag (the commit case for the dispatch rewrite). */
    dragging: boolean;
    /** The machine was pressed or dragging — both can carry a setDrag
     * preview (the pressed→dragging transition emits the first one). */
    previewing: boolean;
    /** The pressed node, when a node was pressed. */
    primaryId: Id | null;
  }

  /** Apply the machine's effects to the UI and doc stores (R6), rewriting
   * drag effects through the kanban planner (T-035). */
  function applyEffects(effects: SelectEffect[], drag: DragCtx): void {
    for (const effect of effects) {
      switch (effect.type) {
        case 'select':
          uiStore.setSelection(effect.ids);
          break;
        case 'selectEdge':
          uiStore.setEdgeSelection(effect.ids);
          break;
        case 'setDrag': {
          let d = effect.drag;
          let kanbanTarget: Id | null = null;
          if (d !== null && drag.previewing) {
            // Kanban (T-035): a single-card drag previews glued to its slot
            // while the card is over a column. Pure math over the current
            // document — the document itself is untouched (I-04). T-037: the
            // plan's target column (also for multi-card drags) becomes the
            // drop-target highlight; over no column it clears.
            const plan = planKanbanDrop(docStore.get(), {
              ids: d.ids,
              dx: d.dx,
              dy: d.dy,
              primaryId: drag.primaryId,
            });
            kanbanTarget = plan.target;
            if (plan.preview !== null) {
              d = { ids: d.ids, dx: plan.preview.dx, dy: plan.preview.dy };
            }
          }
          uiStore.setDrag(d);
          uiStore.setKanbanDropTarget(kanbanTarget);
          break;
        }
        case 'dispatch': {
          let command = effect.command;
          if (
            drag.dragging &&
            command.type === 'node.move' &&
            command.ids.length > 0
          ) {
            // Kanban (T-035): the drag commit. Only a DRAG commit is
            // rewritten — arrow-key nudges dispatch node.move with the
            // machine idle, and they keep their raw deltas.
            command = planKanbanDrop(docStore.get(), {
              ids: command.ids,
              dx: command.dx,
              dy: command.dy,
              primaryId: drag.primaryId,
            }).command;
          }
          docStore.dispatch(command);
          break;
        }
        case 'setBoxSelect':
          uiStore.setBoxSelect(effect.rect);
          break;
        case 'selectInRect':
          uiStore.setSelection(nodesIntersectingScreenRect(effect.rect));
          break;
        case 'setResize':
          uiStore.setResize(effect.rect);
          break;
      }
    }
  }

  /**
   * The ids of every node whose rect intersects a screen-space marquee
   * rect, in `order` (bottom → top) — the box-select resolution (T-017).
   * Pure w.r.t. the stores: reads the camera and the document once.
   */
  function nodesIntersectingScreenRect(rect: {
    x: number;
    y: number;
    w: number;
    h: number;
  }): Id[] {
    const cam = cameraStore.get();
    const topLeft = screenToWorld(cam, { x: rect.x, y: rect.y });
    const bottomRight = screenToWorld(cam, {
      x: rect.x + rect.w,
      y: rect.y + rect.h,
    });
    const worldRect = {
      x: Math.min(topLeft.x, bottomRight.x),
      y: Math.min(topLeft.y, bottomRight.y),
      w: Math.abs(bottomRight.x - topLeft.x),
      h: Math.abs(bottomRight.y - topLeft.y),
    };
    const doc = docStore.get();
    const ids: Id[] = [];
    for (const id of doc.order) {
      const node = doc.nodes[id];
      if (node === undefined) continue; // defensive: order is a permutation
      if (
        rectsIntersect(
          { x: node.x, y: node.y, w: node.w, h: node.h },
          worldRect,
        )
      ) {
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * Hold pointer capture exactly while a gesture on a node is active, so
   * moves and the release keep arriving even outside the canvas (R6).
   */
  function syncPointerCapture(): void {
    const gesturePointer = state.mode !== 'idle' ? state.pointerId : null;
    if (gesturePointer !== null && capturedPointerId === null) {
      try {
        canvas.setPointerCapture(gesturePointer);
        capturedPointerId = gesturePointer;
      } catch {
        // The pointer may already be gone; the gesture still works without
        // capture as long as the pointer stays over the canvas.
      }
    } else if (gesturePointer === null && capturedPointerId !== null) {
      try {
        canvas.releasePointerCapture(capturedPointerId);
      } catch {
        // Capture may already be released (e.g. after pointerup).
      }
      capturedPointerId = null;
    }
  }

  /** The machine context: the selections as of this event. */
  function currentCtx(): SelectCtx {
    const ui = uiStore.get();
    return { selection: ui.selection, edgeSelection: ui.edgeSelection };
  }

  /** Feed one event, apply its effects, sync capture. The drag context is
   * captured BEFORE the reduce (pointer-up resets the machine to idle). */
  function feed(event: SelectEvent): void {
    const mode = state.mode;
    const drag: DragCtx = {
      dragging: mode === 'dragging',
      previewing: mode === 'dragging' || mode === 'pressed',
      primaryId: state.hitId,
    };
    const result = reduce(state, event, currentCtx());
    state = result.state;
    applyEffects(result.effects, drag);
    syncPointerCapture();
  }

  /** Screen (CSS px, canvas-relative) and world position of an event. */
  function positions(e: PointerEvent): {
    screen: { x: number; y: number };
    world: { x: number; y: number };
  } {
    const screen = pointerToCanvasPos(canvas, e.clientX, e.clientY);
    const world = screenToWorld(cameraStore.get(), screen);
    return { screen, world };
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'touch') return; // touch is out of scope
    if (isPanActive()) return; // Space+left and middle belong to panning
    const { screen, world } = positions(e);
    const selection = uiStore.get().selection;
    // A press on a resize handle of the single selected node starts a
    // resize gesture (T-021) — checked before the connect handles and the
    // body, because corners sit outside the node rect.
    const resizeHit = hitTestResizeHandles(
      docStore.get(),
      world,
      cameraStore.get(),
      selection,
    );
    if (resizeHit !== null && resizeHit.type === 'resize') {
      const node = docStore.get().nodes[resizeHit.id]!;
      feed({
        type: 'pointerDown',
        button: e.button,
        pointerId: e.pointerId,
        screen,
        world,
        hitId: resizeHit.id,
        shiftKey: e.shiftKey,
        resize: {
          id: resizeHit.id,
          corner: resizeHit.corner,
          rect: { x: node.x, y: node.y, w: node.w, h: node.h },
        },
      });
      return;
    }
    // T-035: a press on a column's × close affordance arms a column delete
    // (group.delete — the cards survive, ungrouped). Committed on release,
    // like every gesture (D-26); cancel paths disarm silently.
    const closeHit = columnCloseHit(
      docStore.get(),
      world,
      cameraStore.get().zoom,
    );
    if (closeHit !== null) {
      pendingClose = { pointerId: e.pointerId, columnId: closeHit, screen };
      return;
    }
    // T-037: a press on a column's resize affordance (right-edge midpoint,
    // bottom-edge midpoint, bottom-right corner — screen-space targets, the
    // × precedent) arms a resize gesture. Only the primary button (D-26).
    if (e.button === 0) {
      const handleHit = columnResizeHit(
        docStore.get(),
        world,
        cameraStore.get().zoom,
      );
      if (handleHit !== null) {
        const rect = columnEffectiveRect(docStore.get(), handleHit.id);
        if (rect !== null) {
          columnGesture = {
            pointerId: e.pointerId,
            columnId: handleHit.id,
            kind: 'resize',
            edge: handleHit.edge,
            startScreen: screen,
            startWorld: world,
            rect,
            active: false,
          };
          captureColumnPointer(e.pointerId);
          return;
        }
      }
    }
    // A press on a connection handle of a selected node belongs to the
    // connect tool (T-018): stand down so the selection is not cleared and
    // no marquee starts. Body hits fall through like a plain hitTest.
    const hit = hitTestWithHandles(
      docStore.get(),
      world,
      cameraStore.get(),
      selection,
    );
    if (hit !== null && hit.type === 'handle') return;
    const hitId = hit !== null ? hit.id : null;
    // T-033: with nothing else under the pointer, an EDGE can be — it sits
    // above frames but below nodes on the board, so it wins over the frame
    // click target. Resolved here with `edgeAt`; the machine consumes the id.
    const hitEdgeId =
      hitId === null
        ? edgeAt(docStore.get(), world, cameraStore.get().zoom)
        : null;
    // T-037: a press on a column HEADER (no node, no edge under the pointer —
    // they draw above the panel, so they win by render order) arms a column
    // drag. A plain click keeps the T-024 frame behaviour exactly: the
    // members are selected up front, as a press anywhere inside the column
    // does. An empty column has no members to drag along — fall through to
    // the ordinary empty-space flow (marquee), unchanged.
    if (hitId === null && hitEdgeId === null && e.button === 0 && !e.shiftKey) {
      const headerId = columnHeaderHit(docStore.get(), world);
      if (headerId !== null) {
        const doc = docStore.get();
        const members: Id[] = [];
        for (const id of doc.order) {
          if (doc.nodes[id]?.groupId === headerId) members.push(id);
        }
        if (members.length > 0) {
          uiStore.setSelection(members);
          columnGesture = {
            pointerId: e.pointerId,
            columnId: headerId,
            kind: 'move',
            edge: 'right', // unused by a move gesture
            startScreen: screen,
            startWorld: world,
            rect: { x: 0, y: 0, w: 0, h: 0 }, // unused by a move gesture
            active: false,
          };
          captureColumnPointer(e.pointerId);
          return;
        }
      }
    }
    if (hitId === null && !e.shiftKey && hitEdgeId === null) {
      // A press on empty space inside a group FRAME selects all its members
      // (T-024) instead of starting a marquee. Dragging any member afterwards
      // moves the whole group (the machine unions the group's ids).
      const frameGroup = groupFrameAt(docStore.get(), world);
      if (frameGroup !== null) {
        const doc = docStore.get();
        const members: Id[] = [];
        for (const id of doc.order) {
          if (doc.nodes[id]?.groupId === frameGroup) members.push(id);
        }
        if (members.length > 0) {
          uiStore.setSelection(members);
          return;
        }
      }
    }
    feed({
      type: 'pointerDown',
      button: e.button,
      pointerId: e.pointerId,
      screen,
      world,
      hitId,
      shiftKey: e.shiftKey,
      resize: null,
      // T-035: a kanban card drags ALONE — the column is a container, not a
      // move-together unit; regular groups keep the T-024 behaviour.
      groupIds: hitId !== null ? dragMembersOf(docStore.get(), hitId) : [],
      hitEdgeId,
    });
  }

  function onPointerMove(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    // T-037: a column gesture is live even while the select machine is idle
    // (it was armed outside the machine). Move updates the PREVIEW only
    // (I-04); the commit happens on release.
    if (columnGesture !== null && e.pointerId === columnGesture.pointerId) {
      const { screen, world } = positions(e);
      if (!columnGesture.active) {
        const d = Math.hypot(
          screen.x - columnGesture.startScreen.x,
          screen.y - columnGesture.startScreen.y,
        );
        if (d < DRAG_THRESHOLD) return;
        columnGesture.active = true;
      }
      if (columnGesture.kind === 'move') {
        uiStore.setColumnDrag({
          id: columnGesture.columnId,
          dx: world.x - columnGesture.startWorld.x,
          dy: world.y - columnGesture.startWorld.y,
        });
      } else {
        const rect = columnResizeRect(
          columnGesture.rect,
          columnGesture.edge,
          world,
        );
        uiStore.setColumnResize({
          id: columnGesture.columnId,
          x: rect.x,
          y: rect.y,
          w: rect.w,
          h: rect.h,
        });
      }
      return;
    }
    if (state.mode === 'idle') return; // no gesture → nothing to update
    const { screen, world } = positions(e);
    feed({ type: 'pointerMove', pointerId: e.pointerId, screen, world });
  }

  function onPointerUp(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    // T-035: release of an armed × close press — delete the column when the
    // pointer stayed put (a click, D-26); any drag past the threshold
    // disarms silently. Another pointer's release flows on to the machine.
    if (pendingClose !== null && e.pointerId === pendingClose.pointerId) {
      const { screen } = positions(e);
      if (
        Math.hypot(
          screen.x - pendingClose.screen.x,
          screen.y - pendingClose.screen.y,
        ) < DRAG_THRESHOLD
      ) {
        docStore.dispatch({
          type: 'group.delete',
          ids: [pendingClose.columnId],
        });
      }
      pendingClose = null;
      return;
    }
    // T-037: release of a column gesture. Past the threshold it commits
    // exactly ONE batch (I-04) — the move (column + cards) or the resize
    // (geometry + re-fitted cards); under the threshold it was a plain
    // click, whose selection was already set at press. Another pointer's
    // release flows on to the machine.
    if (columnGesture !== null && e.pointerId === columnGesture.pointerId) {
      const gesture = columnGesture;
      const { world } = positions(e);
      if (gesture.active) {
        if (gesture.kind === 'move') {
          docStore.dispatch(
            planColumnMove(
              docStore.get(),
              gesture.columnId,
              world.x - gesture.startWorld.x,
              world.y - gesture.startWorld.y,
            ),
          );
        } else {
          const rect = columnResizeRect(gesture.rect, gesture.edge, world);
          docStore.dispatch(
            planColumnResize(docStore.get(), gesture.columnId, rect),
          );
        }
      }
      endColumnGesture();
      return;
    }
    if (state.mode === 'idle') return; // nobody is pressed on a node
    const { screen, world } = positions(e);
    feed({ type: 'pointerUp', pointerId: e.pointerId, screen, world });
  }

  function onPointerCancel(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    if (pendingClose !== null && e.pointerId === pendingClose.pointerId) {
      pendingClose = null;
      return;
    }
    // T-037: a cancelled column gesture dispatches nothing (D-26).
    if (columnGesture !== null && e.pointerId === columnGesture.pointerId) {
      endColumnGesture();
      return;
    }
    feed({ type: 'pointerCancel', pointerId: e.pointerId });
  }

  function onKeyDown(e: KeyboardEvent): void {
    const key = e.key;
    // Ignore if typing in an input/textarea.
    if (isEditableTarget(e.target)) return; // D-27: never steal typing
    // Ignore Delete/Backspace with modifiers (D-27).
    if (
      (key === 'Delete' || key === 'Backspace') &&
      (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)
    ) {
      return;
    }
    if (key === 'Backspace') e.preventDefault(); // never navigate back
    // T-037: while a column gesture is armed, keys stand down — Escape
    // cancels with no command (D-26), and a stray Delete can never delete
    // the cards of the column being dragged.
    if (columnGesture !== null) {
      if (key === 'Escape') endColumnGesture();
      return;
    }
    // Ctrl+A = select all (T-016).
    if (key === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const doc = docStore.get();
      const allIds = Object.keys(doc.nodes);
      if (allIds.length > 0) {
        uiStore.setSelection(allIds);
      }
      return;
    }
    // Ctrl+C = copy, Ctrl+V = paste, Ctrl+D = duplicate (T-016).
    // These are handled in main.ts for clipboard access.
    feed({
      type: 'key',
      key,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
    });
  }

  function onBlur(): void {
    pendingClose = null;
    endColumnGesture(); // T-037: blur cancels the column gesture, no command
    feed({ type: 'blur' });
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('blur', onBlur);

  return {
    detach() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
      if (capturedPointerId !== null) {
        try {
          canvas.releasePointerCapture(capturedPointerId);
        } catch {
          // Ignore.
        }
        capturedPointerId = null;
      }
      state = initialSelectState();
      pendingClose = null;
      endColumnGesture(); // T-037
    },
  };
}
