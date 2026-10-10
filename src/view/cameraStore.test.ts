import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_CAMERA, type Camera } from './camera';
import { createCameraStore } from './cameraStore';

describe('cameraStore — get / set', () => {
  it('get returns the initial camera', () => {
    const store = createCameraStore({ x: 10, y: 20, zoom: 2 });
    expect(store.get()).toEqual({ x: 10, y: 20, zoom: 2 });
  });

  it('set replaces the camera', () => {
    const store = createCameraStore(DEFAULT_CAMERA);
    const next: Camera = { x: 100, y: 50, zoom: 4 };
    store.set(next);
    expect(store.get()).toBe(next);
  });
});

describe('cameraStore — no notification for an identical camera', () => {
  it('setting the same values does not notify', () => {
    const store = createCameraStore({ x: 1, y: 2, zoom: 3 });
    const fn = vi.fn();
    store.subscribe(fn);
    store.set({ x: 1, y: 2, zoom: 3 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('setting the same object reference does not notify', () => {
    const cam: Camera = { x: 1, y: 2, zoom: 3 };
    const store = createCameraStore(cam);
    const fn = vi.fn();
    store.subscribe(fn);
    store.set(cam);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('cameraStore — notification when any field changes', () => {
  it('notifies when x changes', () => {
    const store = createCameraStore({ x: 0, y: 0, zoom: 1 });
    const fn = vi.fn();
    store.subscribe(fn);
    store.set({ x: 10, y: 0, zoom: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ x: 10, y: 0, zoom: 1 });
  });

  it('notifies when y changes', () => {
    const store = createCameraStore({ x: 0, y: 0, zoom: 1 });
    const fn = vi.fn();
    store.subscribe(fn);
    store.set({ x: 0, y: 5, zoom: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('notifies when zoom changes', () => {
    const store = createCameraStore({ x: 0, y: 0, zoom: 1 });
    const fn = vi.fn();
    store.subscribe(fn);
    store.set({ x: 0, y: 0, zoom: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('notifies with the new camera value', () => {
    const store = createCameraStore({ x: 0, y: 0, zoom: 1 });
    let received: Camera | null = null;
    store.subscribe((cam) => {
      received = cam;
    });
    store.set({ x: 5, y: 6, zoom: 7 });
    expect(received).toEqual({ x: 5, y: 6, zoom: 7 });
  });
});

describe('cameraStore — unsubscribe works', () => {
  it('the subscriber stops receiving after unsubscribe', () => {
    const store = createCameraStore({ x: 0, y: 0, zoom: 1 });
    const fn = vi.fn();
    const unsub = store.subscribe(fn);
    store.set({ x: 1, y: 0, zoom: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
    store.set({ x: 2, y: 0, zoom: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('multiple subscribers are independent', () => {
    const store = createCameraStore({ x: 0, y: 0, zoom: 1 });
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = store.subscribe(a);
    store.subscribe(b);
    store.set({ x: 1, y: 0, zoom: 1 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    unsubA();
    store.set({ x: 2, y: 0, zoom: 1 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });
});

describe('cameraStore — invalid cameras ignored', () => {
  it('non-finite x is ignored', () => {
    const store = createCameraStore({ x: 0, y: 0, zoom: 1 });
    store.set({ x: NaN, y: 0, zoom: 1 });
    expect(store.get()).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('non-finite y is ignored', () => {
    const store = createCameraStore({ x: 0, y: 0, zoom: 1 });
    store.set({ x: 0, y: Infinity, zoom: 1 });
    expect(store.get()).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('non-finite zoom is ignored', () => {
    const store = createCameraStore({ x: 0, y: 0, zoom: 1 });
    store.set({ x: 0, y: 0, zoom: -Infinity });
    expect(store.get()).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('zoom ≤ 0 is ignored', () => {
    const store = createCameraStore({ x: 0, y: 0, zoom: 1 });
    store.set({ x: 0, y: 0, zoom: 0 });
    expect(store.get()).toEqual({ x: 0, y: 0, zoom: 1 });
    store.set({ x: 0, y: 0, zoom: -2 });
    expect(store.get()).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('invalid camera does not notify subscribers', () => {
    const store = createCameraStore({ x: 0, y: 0, zoom: 1 });
    const fn = vi.fn();
    store.subscribe(fn);
    store.set({ x: NaN, y: 0, zoom: 1 });
    expect(fn).not.toHaveBeenCalled();
  });
});
