import { describe, expect, it } from 'vitest';

import { deepEqual } from './deepEqual';

describe('deepEqual — primitives', () => {
  it('numbers: 1 === 1', () => {
    expect(deepEqual(1, 1)).toBe(true);
  });

  it('0 equals -0 (=== semantics, R2)', () => {
    expect(deepEqual(0, -0)).toBe(true);
  });

  it('strings', () => {
    expect(deepEqual('hello', 'hello')).toBe(true);
    expect(deepEqual('hello', 'world')).toBe(false);
  });

  it('booleans', () => {
    expect(deepEqual(true, true)).toBe(true);
    expect(deepEqual(true, false)).toBe(false);
  });

  it('null', () => {
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
  });

  it('undefined', () => {
    expect(deepEqual(undefined, undefined)).toBe(true);
  });

  it('different types are not equal', () => {
    expect(deepEqual(1, '1')).toBe(false);
    expect(deepEqual(0, false)).toBe(false);
    expect(deepEqual(null, 0)).toBe(false);
  });

  it('NaN !== NaN (=== semantics)', () => {
    expect(deepEqual(NaN, NaN)).toBe(false);
  });
});

describe('deepEqual — nested arrays', () => {
  it('equal arrays', () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
  });

  it('arrays of different length are not equal', () => {
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual([1, 2, 3], [1, 2])).toBe(false);
  });

  it('nested arrays', () => {
    expect(deepEqual([[1, 2], [3]], [[1, 2], [3]])).toBe(true);
    expect(deepEqual([[1, 2], [3]], [[1, 2], [4]])).toBe(false);
  });

  it('empty arrays', () => {
    expect(deepEqual([], [])).toBe(true);
    expect(deepEqual([], [1])).toBe(false);
  });
});

describe('deepEqual — objects', () => {
  it('equal objects, same key order', () => {
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });

  it('equal objects, different key order (R2)', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('different values', () => {
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('extra key', () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('nested objects', () => {
    expect(
      deepEqual(
        { outer: { inner: 42 } },
        { outer: { inner: 42 } },
      ),
    ).toBe(true);
    expect(
      deepEqual(
        { outer: { inner: 42 } },
        { outer: { inner: 99 } },
      ),
    ).toBe(false);
  });

  it('undefined key counts as absent (R2)', () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
  });

  it('empty objects', () => {
    expect(deepEqual({}, {})).toBe(true);
  });
});

describe('deepEqual — mixed', () => {
  it('array vs object', () => {
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
  });

  it('complex nested structure', () => {
    const a = {
      nodes: { n1: { id: 'n1', x: 10 } },
      order: ['n1'],
    };
    const b = {
      order: ['n1'],
      nodes: { n1: { x: 10, id: 'n1' } },
    };
    expect(deepEqual(a, b)).toBe(true);
  });
});
