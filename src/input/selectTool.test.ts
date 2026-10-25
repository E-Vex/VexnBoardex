import { describe, expect, it } from 'vitest';

import {
  DRAG_THRESHOLD,
  MIN_NODE_SIZE,
  resizeRect,
  type SelectCtx,
  type SelectEffect,
  type SelectEvent,
  type SelectState,
  initialSelectState,
  reduce,
} from './selectTool';

const NO_SELECTION: SelectCtx = { selection: [] };
const SEL_A: SelectCtx = { selection: ['a'] };

/** A screen-space point. */
function p(x: number, y: number): { x: number; y: number } {
  return { x, y };
}

/** Run one event from idle and return state + effects. */
function run(
  state: SelectState,
  event: SelectEvent,
  ctx: SelectCtx,
): { state: SelectState; effects: SelectEffect[] } {
  return reduce(state, event, ctx);
}

function down(
  screen: { x: number; y: number },
  world: { x: number; y: number },
  hitId: string | null,
  pointerId = 1,
  button = 0,
  shiftKey = false,
): SelectEvent {
  return { type: 'pointerDown', button, pointerId, screen, world, hitId, shiftKey };
}

function move(
  screen: { x: number; y: number },
  world: { x: number; y: number },
  pointerId = 1,
): SelectEvent {
  return { type: 'pointerMove', pointerId, screen, world };
}

function up(
  screen: { x: number; y: number },
  world: { x: number; y: number },
  pointerId = 1,
): SelectEvent {
  return { type: 'pointerUp', pointerId, screen, world };
}

function keyEvent(key: string, shiftKey = false, ctrlKey = false, metaKey = false): SelectEvent {
  return { type: 'key', key, shiftKey, ctrlKey, metaKey };
}

/** Effects of one kind only, for concise assertions. */
function ofType(effects: SelectEffect[], type: SelectEffect['type']) {
  return effects.filter((e) => e.type === type);
}

describe('selectTool — pointerDown (D-26)', () => {
  it('a left press on an unselected node selects it and enters pressed', () => {
    const r = run(initialSelectState(), down(p(10, 10), p(-5, -5), 'a'), NO_SELECTION);
    expect(r.state.mode).toBe('pressed');
    expect(r.state.pointerId).toBe(1);
    expect(r.state.hitId).toBe('a');
    expect(r.state.startScreen).toEqual(p(10, 10));
    expect(r.state.startWorld).toEqual(p(-5, -5));
    expect(r.effects).toEqual([{ type: 'select', ids: ['a'] }]);
  });

  it('a left press on an already-selected node emits no select effect', () => {
    const r = run(initialSelectState(), down(p(10, 10), p(-5, -5), 'a'), SEL_A);
    expect(r.state.mode).toBe('pressed');
    expect(r.effects).toEqual([]);
  });

  it('a left press on empty space clears the selection and starts box-select', () => {
    const r = run(initialSelectState(), down(p(10, 10), p(-5, -5), null), SEL_A);
    expect(r.state.mode).toBe('boxSelecting');
    expect(r.state.pointerId).toBe(1);
    expect(r.effects).toEqual([{ type: 'select', ids: [] }, { type: 'setBoxSelect', rect: { x: 10, y: 10, w: 0, h: 0 } }]);
  });

  it('T-017: a left press on empty space with an empty selection also starts box-select', () => {
    const r = run(initialSelectState(), down(p(10, 10), p(-5, -5), null), NO_SELECTION);
    expect(r.state.mode).toBe('boxSelecting');
    expect(r.state.pointerId).toBe(1);
    // No select effect: the selection is already empty.
    expect(r.effects).toEqual([{ type: 'setBoxSelect', rect: { x: 10, y: 10, w: 0, h: 0 } }]);
  });

  it('a button other than 0 is ignored', () => {
    for (const button of [1, 2, 3, 4, 5]) {
      const r = run(
        initialSelectState(),
        down(p(10, 10), p(-5, -5), 'a', 1, button),
        NO_SELECTION,
      );
      expect(r.state.mode).toBe('idle');
      expect(r.effects).toEqual([]);
    }
  });

  it('a second pointer is ignored while a gesture is active', () => {
    const first = run(initialSelectState(), down(p(10, 10), p(-5, -5), 'a'), NO_SELECTION);
    const second = run(first.state, down(p(50, 50), p(20, 20), 'b', 2), NO_SELECTION);
    expect(second.state).toBe(first.state);
    expect(second.effects).toEqual([]);
  });
});

describe('selectTool — drag threshold (D-26)', () => {
  it('DRAG_THRESHOLD is 4', () => {
    expect(DRAG_THRESHOLD).toBe(4);
  });

  function pressedState(): SelectState {
    return run(initialSelectState(), down(p(100, 100), p(0, 0), 'a'), NO_SELECTION).state;
  }

  it('a move just under the threshold does not start the drag', () => {
    // Euclidean distance sqrt(2²+3²) = 3.606 < 4.
    const r = run(pressedState(), move(p(102, 103), p(2, 3)), NO_SELECTION);
    expect(r.state.mode).toBe('pressed');
    expect(r.effects).toEqual([]);
  });

  it('a move exactly at the threshold starts the drag', () => {
    // Euclidean distance exactly 4.
    const r = run(pressedState(), move(p(104, 100), p(4, 0)), NO_SELECTION);
    expect(r.state.mode).toBe('dragging');
    expect(r.effects).toEqual([
      { type: 'setDrag', drag: { ids: ['a'], dx: 4, dy: 0 } },
    ]);
  });

  it('a move at the threshold on the other axis also starts the drag', () => {
    const r = run(pressedState(), move(p(100, 96), p(0, -4)), NO_SELECTION);
    expect(r.state.mode).toBe('dragging');
  });

  it('a diagonal move whose Euclidean length exceeds 4 starts the drag', () => {
    // hypot(3, 3) = 4.24 ≥ 4; the individual deltas are both below 4, so
    // only the Euclidean measure can start this drag.
    const r = run(pressedState(), move(p(103, 103), p(3, 3)), NO_SELECTION);
    expect(r.state.mode).toBe('dragging');
  });

  it('the threshold is measured from the press point, not the last move', () => {
    const st = pressedState();
    const r1 = run(st, move(p(102, 100), p(2, 0)), NO_SELECTION);
    expect(r1.state.mode).toBe('pressed');
    // (104, 100) is 4 px from the press point (a drag) but only 2 px from
    // the last move — the machine must use the press point.
    const r2 = run(r1.state, move(p(104, 100), p(4, 0)), NO_SELECTION);
    expect(r2.state.mode).toBe('dragging');
  });
});

describe('selectTool — dx/dy are world deltas at two zoom scales (D-26)', () => {
  it('zoom 1: a 100 px screen drag is a 100 unit world delta', () => {
    // cam {x:-640, y:-360, zoom:1}: screen (300,200) → world (-340,-160);
    // screen (400,200) → world (-240,-160).
    const st = run(
      initialSelectState(),
      down(p(300, 200), p(-340, -160), 'a'),
      NO_SELECTION,
    ).state;
    const r = run(st, move(p(400, 200), p(-240, -160)), NO_SELECTION);
    expect(r.state.mode).toBe('dragging');
    expect(r.effects).toEqual([
      { type: 'setDrag', drag: { ids: ['a'], dx: 100, dy: 0 } },
    ]);
  });

  it('zoom 2: a 50 px screen drag is a 25 unit world delta', () => {
    // cam {x:-100, y:-50, zoom:2}: screen (100,100) → world (50,100);
    // screen (150,100) → world (75,100).
    const st = run(
      initialSelectState(),
      down(p(100, 100), p(50, 100), 'a'),
      NO_SELECTION,
    ).state;
    const r = run(st, move(p(150, 100), p(75, 100)), NO_SELECTION);
    expect(r.state.mode).toBe('dragging');
    expect(r.effects).toEqual([
      { type: 'setDrag', drag: { ids: ['a'], dx: 25, dy: 0 } },
    ]);
  });
});

describe('selectTool — pointer-up commits exactly one node.move (D-26, I-04)', () => {
  it('a full drag sequence produces exactly one dispatch on release', () => {
    let st = initialSelectState();
    const all: SelectEffect[] = [];

    let r = run(st, down(p(300, 230), p(-340, -130), 'a'), NO_SELECTION);
    st = r.state;
    all.push(...r.effects);

    r = run(st, move(p(300, 280), p(-340, -80)), NO_SELECTION);
    st = r.state;
    all.push(...r.effects);

    r = run(st, move(p(300, 330), p(-340, -30)), NO_SELECTION);
    st = r.state;
    all.push(...r.effects);

    expect(st.mode).toBe('dragging');

    r = run(st, up(p(300, 330), p(-340, -30)), NO_SELECTION);
    st = r.state;
    all.push(...r.effects);

    expect(st.mode).toBe('idle');
    // Exactly one dispatch in the whole sequence…
    const dispatches = ofType(all, 'dispatch');
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toEqual({
      type: 'dispatch',
      command: { type: 'node.move', ids: ['a'], dx: 0, dy: 100 },
    });
    // …and every move before the release produced setDrag effects only.
    const beforeUp = all.slice(0, all.length - r.effects.length);
    expect(ofType(beforeUp, 'dispatch')).toHaveLength(0);
    expect(ofType(beforeUp, 'setDrag')).toHaveLength(2);
    // The release clears the preview.
    expect(r.effects).toEqual([
      { type: 'setDrag', drag: null },
      {
        type: 'dispatch',
        command: { type: 'node.move', ids: ['a'], dx: 0, dy: 100 },
      },
    ]);
  });

  it('pointer-up while dragging uses the world position at up, not the last move', () => {
    let st = run(initialSelectState(), down(p(0, 0), p(0, 0), 'a'), NO_SELECTION).state;
    st = run(st, move(p(50, 0), p(50, 0)), NO_SELECTION).state;
    const r = run(st, up(p(80, 10), p(80, 10)), NO_SELECTION);
    expect(ofType(r.effects, 'dispatch')).toEqual([
      { type: 'dispatch', command: { type: 'node.move', ids: ['a'], dx: 80, dy: 10 } },
    ]);
  });

  it('pointer-up under the threshold is a click: no command, no setDrag', () => {
    const st = run(initialSelectState(), down(p(100, 100), p(0, 0), 'a'), NO_SELECTION).state;
    const r = run(st, up(p(102, 101), p(2, 1)), NO_SELECTION);
    expect(r.state.mode).toBe('idle');
    expect(r.effects).toEqual([]);
  });

  it('a zero-delta drag still dispatches one node.move (a no-op command)', () => {
    let st = run(initialSelectState(), down(p(100, 100), p(0, 0), 'a'), NO_SELECTION).state;
    st = run(st, move(p(200, 100), p(100, 0)), NO_SELECTION).state;
    const r = run(st, up(p(100, 100), p(0, 0)), NO_SELECTION);
    expect(ofType(r.effects, 'dispatch')).toEqual([
      { type: 'dispatch', command: { type: 'node.move', ids: ['a'], dx: 0, dy: 0 } },
    ]);
  });
});

describe('selectTool — cancel paths produce no command (D-26)', () => {
  function draggingState(): SelectState {
    const st = run(initialSelectState(), down(p(100, 100), p(0, 0), 'a'), NO_SELECTION).state;
    return run(st, move(p(200, 100), p(100, 0)), NO_SELECTION).state;
  }

  it('Escape while dragging cancels: setDrag(null), setBoxSelect(null), no dispatch', () => {
    const r = run(draggingState(), keyEvent('Escape'), NO_SELECTION);
    expect(r.state.mode).toBe('idle');
    expect(r.effects).toEqual([{ type: 'setDrag', drag: null }, { type: 'setBoxSelect', rect: null }]);
  });

  it('pointercancel while dragging cancels: setDrag(null), setBoxSelect(null), no dispatch', () => {
    const r = run(draggingState(), { type: 'pointerCancel', pointerId: 1 }, NO_SELECTION);
    expect(r.state.mode).toBe('idle');
    expect(r.effects).toEqual([{ type: 'setDrag', drag: null }, { type: 'setBoxSelect', rect: null }]);
  });

  it('blur while dragging cancels: setDrag(null), setBoxSelect(null), no dispatch', () => {
    const r = run(draggingState(), { type: 'blur' }, NO_SELECTION);
    expect(r.state.mode).toBe('idle');
    expect(r.effects).toEqual([{ type: 'setDrag', drag: null }, { type: 'setBoxSelect', rect: null }]);
  });

  it('Escape while pressed (no drag yet) cancels with no effects', () => {
    const st = run(initialSelectState(), down(p(100, 100), p(0, 0), 'a'), NO_SELECTION)
      .state;
    const r = run(st, keyEvent('Escape'), NO_SELECTION);
    expect(r.state.mode).toBe('idle');
    expect(r.effects).toEqual([]);
  });

  it('pointercancel for another pointer is ignored', () => {
    const r = run(draggingState(), { type: 'pointerCancel', pointerId: 7 }, NO_SELECTION);
    expect(r.state.mode).toBe('dragging');
    expect(r.effects).toEqual([]);
  });

  it('after Escape the drag is over: moves and pointer-up do nothing', () => {
    let st = draggingState();
    st = run(st, keyEvent('Escape'), NO_SELECTION).state;
    const r1 = run(st, move(p(300, 100), p(200, 0)), NO_SELECTION);
    expect(r1.state.mode).toBe('idle');
    expect(r1.effects).toEqual([]);
    const r2 = run(r1.state, up(p(300, 100), p(200, 0)), NO_SELECTION);
    expect(r2.effects).toEqual([]);
  });
});

describe('selectTool — keys (D-27)', () => {
  it('Delete with a selection dispatches one node.delete', () => {
    const r = run(initialSelectState(), keyEvent('Delete'), { selection: ['a', 'b'] });
    expect(r.effects).toEqual([
      { type: 'dispatch', command: { type: 'node.delete', ids: ['a', 'b'] } },
    ]);
    expect(r.state.mode).toBe('idle');
  });

  it('Backspace behaves exactly like Delete', () => {
    const r = run(initialSelectState(), keyEvent('Backspace'), SEL_A);
    expect(r.effects).toEqual([
      { type: 'dispatch', command: { type: 'node.delete', ids: ['a'] } },
    ]);
  });

  it('Delete with an empty selection does nothing', () => {
    const r = run(initialSelectState(), keyEvent('Delete'), NO_SELECTION);
    expect(r.effects).toEqual([]);
  });

  it('Delete while dragging is ignored', () => {
    let st = run(initialSelectState(), down(p(100, 100), p(0, 0), 'a'), NO_SELECTION).state;
    st = run(st, move(p(200, 100), p(100, 0)), NO_SELECTION).state;
    const r = run(st, keyEvent('Delete'), SEL_A);
    expect(r.state.mode).toBe('dragging');
    expect(r.effects).toEqual([]);
  });

  it('Delete while pressed (button held, no drag yet) is ignored', () => {
    const st = run(initialSelectState(), down(p(100, 100), p(0, 0), 'a'), NO_SELECTION)
      .state;
    const r = run(st, keyEvent('Delete'), SEL_A);
    expect(r.state.mode).toBe('pressed');
    expect(r.effects).toEqual([]);
  });

  it('Escape when idle does nothing', () => {
    const r = run(initialSelectState(), keyEvent('Escape'), SEL_A);
    expect(r.state.mode).toBe('idle');
    expect(r.effects).toEqual([]);
  });

  it('any other key is ignored', () => {
    for (const key of ['a', 'Enter', 'Tab', 'x']) {
      const r = run(initialSelectState(), keyEvent(key), SEL_A);
      expect(r.effects).toEqual([]);
    }
  });
});

describe('selectTool — irrelevant events (R4)', () => {
  it('pointerMove while idle is ignored', () => {
    const r = run(initialSelectState(), move(p(500, 500), p(100, 100)), NO_SELECTION);
    expect(r.state.mode).toBe('idle');
    expect(r.effects).toEqual([]);
  });

  it('pointerUp while idle is ignored', () => {
    const r = run(initialSelectState(), up(p(500, 500), p(100, 100)), NO_SELECTION);
    expect(r.state.mode).toBe('idle');
    expect(r.effects).toEqual([]);
  });

  it('pointerMove/pointerUp for a different pointer are ignored', () => {
    const st = run(initialSelectState(), down(p(100, 100), p(0, 0), 'a'), NO_SELECTION).state;
    const r1 = run(st, move(p(500, 500), p(400, 400), 9), NO_SELECTION);
    expect(r1.state.mode).toBe('pressed');
    expect(r1.effects).toEqual([]);
    const r2 = run(st, up(p(500, 500), p(400, 400), 9), NO_SELECTION);
    expect(r2.state.mode).toBe('pressed');
    expect(r2.effects).toEqual([]);
  });

  it('blur when idle does nothing', () => {
    const r = run(initialSelectState(), { type: 'blur' }, SEL_A);
    expect(r.state.mode).toBe('idle');
    expect(r.effects).toEqual([]);
  });
});

describe('selectTool — box-select lifecycle (T-017)', () => {
  /** A box-selecting state started at screen (100, 100). */
  function boxSelecting(): SelectState {
    return run(
      initialSelectState(),
      down(p(100, 100), p(0, 0), null),
      NO_SELECTION,
    ).state;
  }

  it('the boxSelecting state remembers the pointerId (regression: stuck machine)', () => {
    const st = boxSelecting();
    expect(st.mode).toBe('boxSelecting');
    expect(st.pointerId).toBe(1);
  });

  it('pointer-up after a marquee emits the final rect as selectInRect', () => {
    let st = boxSelecting();
    st = run(st, move(p(200, 180), p(100, 80)), NO_SELECTION).state;
    const r = run(st, up(p(200, 180), p(100, 80)), NO_SELECTION);
    expect(r.state.mode).toBe('idle');
    expect(r.effects).toEqual([
      { type: 'setBoxSelect', rect: null },
      { type: 'selectInRect', rect: { x: 100, y: 100, w: 100, h: 80 } },
    ]);
  });

  it('a marquee dragged up-left normalises the rect', () => {
    const st = run(
      initialSelectState(),
      down(p(200, 180), p(100, 80), null),
      NO_SELECTION,
    ).state;
    const r = run(st, up(p(100, 100), p(0, 0)), NO_SELECTION);
    expect(ofType(r.effects, 'selectInRect')).toEqual([
      { type: 'selectInRect', rect: { x: 100, y: 100, w: 100, h: 80 } },
    ]);
  });

  it('a click-sized marquee (no move) still emits selectInRect with a zero rect', () => {
    const st = boxSelecting();
    const r = run(st, up(p(100, 100), p(0, 0)), NO_SELECTION);
    expect(ofType(r.effects, 'selectInRect')).toEqual([
      { type: 'selectInRect', rect: { x: 100, y: 100, w: 0, h: 0 } },
    ]);
  });

  it('pointer-up for another pointer does not end the marquee (regression)', () => {
    const st = boxSelecting();
    const r = run(st, up(p(500, 500), p(400, 400), 9), NO_SELECTION);
    expect(r.state.mode).toBe('boxSelecting');
    expect(r.effects).toEqual([]);
  });

  it('Escape during a marquee cancels it without selecting', () => {
    const st = boxSelecting();
    const moved = run(st, move(p(200, 180), p(100, 80)), NO_SELECTION);
    const r = run(moved.state, keyEvent('Escape'), NO_SELECTION);
    expect(r.state.mode).toBe('idle');
    expect(r.effects).toEqual([{ type: 'setDrag', drag: null }, { type: 'setBoxSelect', rect: null }]);
  });
});

describe('selectTool — group move (T-017)', () => {
  const SEL_AB: SelectCtx = { selection: ['a', 'b'] };

  /** A pressed state on node 'b' while ['a','b'] is selected. */
  function pressedOnBInAB(): SelectState {
    return run(
      initialSelectState(),
      down(p(300, 230), p(-340, -130), 'b'),
      SEL_AB,
    ).state;
  }

  it('pressing an already-selected node drags the whole selection', () => {
    const st = pressedOnBInAB();
    expect(st.dragIds).toEqual(['a', 'b']);
    // No select effect: the selection is unchanged.
  });

  it('the drag preview moves every selected id', () => {
    const st = pressedOnBInAB();
    const r = run(st, move(p(300, 330), p(-340, -30)), SEL_AB);
    expect(r.effects).toEqual([
      { type: 'setDrag', drag: { ids: ['a', 'b'], dx: 0, dy: 100 } },
    ]);
  });

  it('pointer-up commits ONE node.move for every selected id', () => {
    let st = pressedOnBInAB();
    st = run(st, move(p(300, 330), p(-340, -30)), SEL_AB).state;
    const r = run(st, up(p(300, 330), p(-340, -30)), SEL_AB);
    expect(ofType(r.effects, 'dispatch')).toEqual([
      {
        type: 'dispatch',
        command: { type: 'node.move', ids: ['a', 'b'], dx: 0, dy: 100 },
      },
    ]);
  });

  it('pressing an unselected node drags only it', () => {
    const st = run(
      initialSelectState(),
      down(p(10, 10), p(0, 0), 'c'),
      SEL_AB,
    ).state;
    expect(st.dragIds).toEqual(['c']);
  });

  it('shift-toggle off then drag drags only the pressed node', () => {
    // Selection [a, b], shift-click b → toggles b off → [a]. Dragging b now
    // moves b alone.
    const st = run(
      initialSelectState(),
      down(p(300, 230), p(-340, -130), 'b', 1, 0, true),
      SEL_AB,
    ).state;
    expect(st.dragIds).toEqual(['b']);
    const r = run(st, move(p(300, 330), p(-340, -30)), { selection: ['a'] });
    expect(ofType(r.effects, 'setDrag')).toEqual([
      { type: 'setDrag', drag: { ids: ['b'], dx: 0, dy: 100 } },
    ]);
  });

  it('shift-toggle on adds to the selection and drags all of it', () => {
    // Selection [a], shift-click b → [a, b]. Dragging b moves both.
    const st = run(
      initialSelectState(),
      down(p(300, 230), p(-340, -130), 'b', 1, 0, true),
      { selection: ['a'] },
    ).state;
    expect(st.dragIds).toEqual(['a', 'b']);
  });
});

describe('selectTool — resize gesture (T-021)', () => {
  /** A pointerDown on the SE corner of node 'a' (rect 0,0 200×120). */
  function resizeDown() {
    return run(
      initialSelectState(),
      {
        type: 'pointerDown',
        button: 0,
        pointerId: 1,
        screen: p(200, 120),
        world: p(200, 120),
        hitId: 'a',
        shiftKey: false,
        resize: { id: 'a', corner: 'se', rect: { x: 0, y: 0, w: 200, h: 120 } },
      },
      SEL_A,
    );
  }

  it('a resize-handle press enters resizing without touching the selection', () => {
    const r = resizeDown();
    expect(r.state.mode).toBe('resizing');
    expect(r.effects).toEqual([]);
  });

  it('pointer-move only previews: one setResize effect per move (I-04)', () => {
    const st = resizeDown().state;
    const r = run(st, move(p(300, 200), p(300, 200)), SEL_A);
    expect(r.state.mode).toBe('resizing');
    expect(r.effects).toEqual([
      { type: 'setResize', rect: { id: 'a', x: 0, y: 0, w: 300, h: 200 } },
    ]);
  });

  it('pointer-up commits exactly ONE node.resize with the final rect', () => {
    let st = resizeDown().state;
    st = run(st, move(p(320, 240), p(320, 240)), SEL_A).state;
    const r = run(st, up(p(320, 240), p(320, 240)), SEL_A);
    expect(r.state.mode).toBe('idle');
    expect(ofType(r.effects, 'dispatch')).toEqual([
      {
        type: 'dispatch',
        command: { type: 'node.resize', id: 'a', x: 0, y: 0, w: 320, h: 240 },
      },
    ]);
    expect(ofType(r.effects, 'setResize')).toEqual([
      { type: 'setResize', rect: null },
    ]);
  });

  it('the NW corner anchors the south-east corner', () => {
    const down = run(
      initialSelectState(),
      {
        type: 'pointerDown',
        button: 0,
        pointerId: 1,
        screen: p(0, 0),
        world: p(0, 0),
        hitId: 'a',
        shiftKey: false,
        resize: { id: 'a', corner: 'nw', rect: { x: 0, y: 0, w: 200, h: 120 } },
      },
      SEL_A,
    );
    const r = run(down.state, move(p(-50, -30), p(-50, -30)), SEL_A);
    expect(ofType(r.effects, 'setResize')).toEqual([
      { type: 'setResize', rect: { id: 'a', x: -50, y: -30, w: 250, h: 150 } },
    ]);
  });

  it('dragging a corner past the opposite edge clamps to MIN_NODE_SIZE', () => {
    const st = resizeDown().state;
    // Drag the SE corner far to the upper-left of the anchored NW corner.
    const r = run(st, move(p(-500, -500), p(-500, -500)), SEL_A);
    expect(ofType(r.effects, 'setResize')).toEqual([
      { type: 'setResize', rect: { id: 'a', x: 0, y: 0, w: MIN_NODE_SIZE, h: MIN_NODE_SIZE } },
    ]);
  });

  it('Escape during a resize cancels with no command', () => {
    let st = resizeDown().state;
    st = run(st, move(p(300, 200), p(300, 200)), SEL_A).state;
    const r = run(st, keyEvent('Escape'), SEL_A);
    expect(r.state.mode).toBe('idle');
    expect(r.effects).toEqual([{ type: 'setResize', rect: null }]);
  });
});

describe('resizeRect — geometry (T-021)', () => {
  const orig = { x: 10, y: 20, w: 100, h: 50 };

  it('se grows to the cursor', () => {
    expect(resizeRect(orig, 'se', { x: 110, y: 70 })).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    expect(resizeRect(orig, 'se', { x: 160, y: 120 })).toEqual({ x: 10, y: 20, w: 150, h: 100 });
  });

  it('nw moves x/y and keeps the se corner fixed', () => {
    expect(resizeRect(orig, 'nw', { x: 0, y: 0 })).toEqual({ x: 0, y: 0, w: 110, h: 70 });
  });

  it('ne and sw each move one edge only', () => {
    expect(resizeRect(orig, 'ne', { x: 200, y: 0 })).toEqual({ x: 10, y: 0, w: 190, h: 70 });
    expect(resizeRect(orig, 'sw', { x: 0, y: 100 })).toEqual({ x: 0, y: 20, w: 110, h: 80 });
  });
});
