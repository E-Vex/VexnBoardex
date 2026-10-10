import { describe, expect, it } from 'vitest';

import { isEditableTarget, zoomKeyAction } from './keys';

const noMods = {
  key: '',
  code: '',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
};

describe('zoomKeyAction — zoom-in keys → factor 1.25 (R4)', () => {
  it('`+` → factor 1.25', () => {
    expect(zoomKeyAction({ ...noMods, key: '+', code: 'Equal' })).toEqual({
      type: 'factor',
      factor: 1.25,
    });
  });

  it('`=` → factor 1.25', () => {
    expect(zoomKeyAction({ ...noMods, key: '=', code: 'Equal' })).toEqual({
      type: 'factor',
      factor: 1.25,
    });
  });

  it('`NumpadAdd` → factor 1.25', () => {
    expect(
      zoomKeyAction({ ...noMods, key: 'NumpadAdd', code: 'NumpadAdd' }),
    ).toEqual({ type: 'factor', factor: 1.25 });
  });
});

describe('zoomKeyAction — zoom-out keys → factor 0.8 (R4)', () => {
  it('`-` → factor 0.8', () => {
    expect(zoomKeyAction({ ...noMods, key: '-', code: 'Minus' })).toEqual({
      type: 'factor',
      factor: 0.8,
    });
  });

  it('`NumpadSubtract` → factor 0.8', () => {
    expect(
      zoomKeyAction({ ...noMods, key: 'NumpadSubtract', code: 'NumpadSubtract' }),
    ).toEqual({ type: 'factor', factor: 0.8 });
  });
});

describe('zoomKeyAction — reset keys → reset (R4)', () => {
  it('`0` → reset', () => {
    expect(zoomKeyAction({ ...noMods, key: '0', code: 'Digit0' })).toEqual({
      type: 'reset',
    });
  });

  it('`Numpad0` → reset', () => {
    expect(
      zoomKeyAction({ ...noMods, key: 'Numpad0', code: 'Numpad0' }),
    ).toEqual({ type: 'reset' });
  });
});

describe('zoomKeyAction — null when a modifier is held (R4)', () => {
  const base = { ...noMods, key: '+', code: 'Equal' };

  it('ctrlKey → null', () => {
    expect(zoomKeyAction({ ...base, ctrlKey: true })).toBeNull();
  });

  it('metaKey → null', () => {
    expect(zoomKeyAction({ ...base, metaKey: true })).toBeNull();
  });

  it('altKey → null', () => {
    expect(zoomKeyAction({ ...base, altKey: true })).toBeNull();
  });
});

describe('zoomKeyAction — null for unmapped keys (R4)', () => {
  it('`a` → null', () => {
    expect(zoomKeyAction({ ...noMods, key: 'a', code: 'KeyA' })).toBeNull();
  });

  it('`Enter` → null', () => {
    expect(zoomKeyAction({ ...noMods, key: 'Enter', code: 'Enter' })).toBeNull();
  });

  it('`Space` → null (Space is handled by the pan controller, not here)', () => {
    expect(zoomKeyAction({ ...noMods, key: ' ', code: 'Space' })).toBeNull();
  });
});

describe('isEditableTarget (R4)', () => {
  it('`<input>` → true', () => {
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true);
  });

  it('`<textarea>` → true', () => {
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true);
  });

  it('`<select>` → true', () => {
    expect(isEditableTarget({ tagName: 'SELECT' })).toBe(true);
  });

  it('contenteditable element → true', () => {
    expect(isEditableTarget({ isContentEditable: true })).toBe(true);
  });

  it('`<div>` (not editable) → false', () => {
    expect(isEditableTarget({ tagName: 'DIV' })).toBe(false);
  });

  it('`<canvas>` → false', () => {
    expect(isEditableTarget({ tagName: 'CANVAS' })).toBe(false);
  });

  it('null → false', () => {
    expect(isEditableTarget(null)).toBe(false);
  });

  it('undefined → false', () => {
    expect(isEditableTarget(undefined)).toBe(false);
  });

  it('a string → false', () => {
    expect(isEditableTarget('not an element')).toBe(false);
  });
});
