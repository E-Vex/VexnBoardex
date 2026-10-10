import { describe, expect, it } from 'vitest';

import type { Point } from '../core/geometry';
import { cursorFor, initialPanState, reduce } from './panController';

const p = (x: number, y: number): Point => ({ x, y });

describe('panController — initial state', () => {
  it('starts idle, space not held, no last point, no pointer', () => {
    expect(initialPanState()).toEqual({
      mode: 'idle',
      spaceHeld: false,
      last: null,
      pointerId: null,
    });
  });
});

describe('panController — spaceDown / spaceUp', () => {
  it('spaceDown sets spaceHeld', () => {
    const r = reduce(initialPanState(), { type: 'spaceDown' });
    expect(r.state.spaceHeld).toBe(true);
    expect(r.state.mode).toBe('idle');
  });

  it('spaceDown is idempotent (no duplicate state object)', () => {
    const s = reduce(initialPanState(), { type: 'spaceDown' }).state;
    const r = reduce(s, { type: 'spaceDown' });
    expect(r.state).toBe(s);
  });

  it('spaceUp clears spaceHeld', () => {
    const s = reduce(initialPanState(), { type: 'spaceDown' }).state;
    const r = reduce(s, { type: 'spaceUp' });
    expect(r.state.spaceHeld).toBe(false);
  });
});

describe('panController — pointerDown starts panning (R3)', () => {
  it('button 1 (middle) starts panning without space', () => {
    const r = reduce(initialPanState(), {
      type: 'pointerDown',
      button: 1,
      pointerId: 0,
      pos: p(100, 200),
    });
    expect(r.state).toEqual({
      mode: 'panning',
      spaceHeld: false,
      last: p(100, 200),
      pointerId: 0,
    });
  });

  it('button 0 with spaceHeld starts panning', () => {
    const s = reduce(initialPanState(), { type: 'spaceDown' }).state;
    const r = reduce(s, {
      type: 'pointerDown',
      button: 0,
      pointerId: 0,
      pos: p(10, 20),
    });
    expect(r.state.mode).toBe('panning');
    expect(r.state.last).toEqual(p(10, 20));
  });

  it('button 0 without space does nothing', () => {
    const r = reduce(initialPanState(), {
      type: 'pointerDown',
      button: 0,
      pointerId: 0,
      pos: p(10, 20),
    });
    expect(r.state.mode).toBe('idle');
    expect(r.state.last).toBeNull();
  });

  it('pointerDown while already panning is ignored', () => {
    const s = reduce(initialPanState(), {
      type: 'pointerDown',
      button: 1,
      pointerId: 0,
      pos: p(0, 0),
    }).state;
    const r = reduce(s, {
      type: 'pointerDown',
      button: 1,
      pointerId: 1,
      pos: p(50, 50),
    });
    expect(r.state.pointerId).toBe(0);
    expect(r.state.last).toEqual(p(0, 0));
  });
});

describe('panController — pointerMove emits pan delta (R3)', () => {
  it('move for the active pointer emits pos − last', () => {
    const s = reduce(initialPanState(), {
      type: 'pointerDown',
      button: 1,
      pointerId: 0,
      pos: p(100, 100),
    }).state;
    const r = reduce(s, {
      type: 'pointerMove',
      pointerId: 0,
      pos: p(130, 120),
    });
    expect(r.pan).toEqual({ dx: 30, dy: 20 });
    expect(r.state.last).toEqual(p(130, 120));
  });

  it('move for a non-active pointer is ignored', () => {
    const s = reduce(initialPanState(), {
      type: 'pointerDown',
      button: 1,
      pointerId: 0,
      pos: p(100, 100),
    }).state;
    const r = reduce(s, {
      type: 'pointerMove',
      pointerId: 99,
      pos: p(0, 0),
    });
    expect(r.pan).toBeUndefined();
    expect(r.state.last).toEqual(p(100, 100));
  });

  it('move while idle is ignored', () => {
    const r = reduce(initialPanState(), {
      type: 'pointerMove',
      pointerId: 0,
      pos: p(50, 50),
    });
    expect(r.pan).toBeUndefined();
  });
});

describe('panController — full drag sequence deltas add up', () => {
  it('emitted deltas sum to total displacement', () => {
    let state = reduce(initialPanState(), { type: 'spaceDown' }).state;
    state = reduce(state, {
      type: 'pointerDown',
      button: 0,
      pointerId: 0,
      pos: p(400, 300),
    }).state;

    const steps: Point[] = [
      p(420, 310),
      p(450, 330),
      p(480, 340),
      p(500, 350),
    ];
    let totalDx = 0;
    let totalDy = 0;
    for (const pos of steps) {
      const r = reduce(state, { type: 'pointerMove', pointerId: 0, pos });
      state = r.state;
      if (r.pan) {
        totalDx += r.pan.dx;
        totalDy += r.pan.dy;
      }
    }
    // Total displacement: (500−400, 350−300) = (100, 50)
    expect(totalDx).toBe(100);
    expect(totalDy).toBe(50);
  });
});

describe('panController — pointerUp / pointerCancel (R3)', () => {
  it('pointerUp for the active pointer returns to idle, keeps spaceHeld', () => {
    let state = reduce(initialPanState(), { type: 'spaceDown' }).state;
    state = reduce(state, {
      type: 'pointerDown',
      button: 0,
      pointerId: 0,
      pos: p(0, 0),
    }).state;
    const r = reduce(state, { type: 'pointerUp', pointerId: 0 });
    expect(r.state.mode).toBe('idle');
    expect(r.state.spaceHeld).toBe(true);
    expect(r.state.last).toBeNull();
    expect(r.state.pointerId).toBeNull();
  });

  it('pointerCancel for the active pointer returns to idle', () => {
    const state = reduce(initialPanState(), {
      type: 'pointerDown',
      button: 1,
      pointerId: 0,
      pos: p(0, 0),
    }).state;
    const r = reduce(state, { type: 'pointerCancel', pointerId: 0 });
    expect(r.state.mode).toBe('idle');
  });

  it('pointerUp for a non-active pointer is ignored', () => {
    const state = reduce(initialPanState(), {
      type: 'pointerDown',
      button: 1,
      pointerId: 0,
      pos: p(0, 0),
    }).state;
    const r = reduce(state, { type: 'pointerUp', pointerId: 99 });
    expect(r.state.mode).toBe('panning');
  });
});

describe('panController — spaceUp during a pan (R3)', () => {
  it('clears spaceHeld but keeps panning until release', () => {
    let state = reduce(initialPanState(), { type: 'spaceDown' }).state;
    state = reduce(state, {
      type: 'pointerDown',
      button: 0,
      pointerId: 0,
      pos: p(0, 0),
    }).state;
    // spaceUp mid-pan
    const r = reduce(state, { type: 'spaceUp' });
    expect(r.state.mode).toBe('panning');
    expect(r.state.spaceHeld).toBe(false);
    // Still responds to moves
    const r2 = reduce(r.state, {
      type: 'pointerMove',
      pointerId: 0,
      pos: p(10, 5),
    });
    expect(r2.pan).toEqual({ dx: 10, dy: 5 });
    // And releases
    const r3 = reduce(r2.state, { type: 'pointerUp', pointerId: 0 });
    expect(r3.state.mode).toBe('idle');
  });
});

describe('panController — blur resets everything (R3)', () => {
  it('blur mid-pan returns to idle with spaceHeld false', () => {
    let state = reduce(initialPanState(), { type: 'spaceDown' }).state;
    state = reduce(state, {
      type: 'pointerDown',
      button: 0,
      pointerId: 0,
      pos: p(0, 0),
    }).state;
    const r = reduce(state, { type: 'blur' });
    expect(r.state).toEqual(initialPanState());
  });

  it('blur when space is held but idle also clears spaceHeld', () => {
    const state = reduce(initialPanState(), { type: 'spaceDown' }).state;
    const r = reduce(state, { type: 'blur' });
    expect(r.state.spaceHeld).toBe(false);
    expect(r.state.mode).toBe('idle');
  });
});

describe('panController — second pointer ignored (R3)', () => {
  it('a second pointer down while panning is ignored', () => {
    const state = reduce(initialPanState(), {
      type: 'pointerDown',
      button: 1,
      pointerId: 0,
      pos: p(0, 0),
    }).state;
    // second pointer down
    const r1 = reduce(state, {
      type: 'pointerDown',
      button: 1,
      pointerId: 1,
      pos: p(50, 50),
    });
    expect(r1.state.pointerId).toBe(0);
    // second pointer move
    const r2 = reduce(r1.state, {
      type: 'pointerMove',
      pointerId: 1,
      pos: p(60, 60),
    });
    expect(r2.pan).toBeUndefined();
    // second pointer up
    const r3 = reduce(r2.state, { type: 'pointerUp', pointerId: 1 });
    expect(r3.state.mode).toBe('panning');
  });
});

describe('cursorFor — all three states (R3)', () => {
  it('idle, no space → default', () => {
    expect(cursorFor(initialPanState())).toBe('default');
  });

  it('idle, space held → grab', () => {
    const s = reduce(initialPanState(), { type: 'spaceDown' }).state;
    expect(cursorFor(s)).toBe('grab');
  });

  it('panning → grabbing', () => {
    const s = reduce(initialPanState(), {
      type: 'pointerDown',
      button: 1,
      pointerId: 0,
      pos: p(0, 0),
    }).state;
    expect(cursorFor(s)).toBe('grabbing');
  });

  it('panning after spaceUp (mid-pan) → grabbing', () => {
    let s = reduce(initialPanState(), { type: 'spaceDown' }).state;
    s = reduce(s, {
      type: 'pointerDown',
      button: 0,
      pointerId: 0,
      pos: p(0, 0),
    }).state;
    s = reduce(s, { type: 'spaceUp' }).state;
    expect(cursorFor(s)).toBe('grabbing');
  });
});
