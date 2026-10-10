/**
 * Zoom key mapping (T-005 R4) — pure, DOM-free (PLAN D-06, R7).
 *
 * Maps a keyboard event's `key` / `code` (plus modifier state) to a zoom
 * action. Also exports `isEditableTarget` so the DOM glue can skip space and
 * zoom keys when the focus is inside an editable element.
 *
 * The `Element` type is intentionally NOT referenced here — the DOM-free ESLint
 * rule forbids it. `isEditableTarget` takes `unknown` and the DOM glue passes
 * the real `EventTarget | null` through. This keeps `keys.ts` pure and testable
 * without a DOM.
 */

export type ZoomAction =
  | { type: 'factor'; factor: number }
  | { type: 'reset' };

/** Input shape for `zoomKeyAction` (a subset of `KeyboardEvent`). */
export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** Zoom-in keys → factor 1.25 (R4). */
const ZOOM_IN_FACTOR = 1.25;
/** Zoom-out keys → factor 0.8 (R4). */
const ZOOM_OUT_FACTOR = 0.8;

const ZOOM_IN_KEYS = new Set(['+', '=', 'NumpadAdd']);
const ZOOM_OUT_KEYS = new Set(['-', 'NumpadSubtract']);
const ZOOM_RESET_KEYS = new Set(['0', 'Numpad0']);

/**
 * Map a keyboard event to a zoom action (R4):
 * - `+`, `=`, `NumpadAdd` → `{ type: 'factor', factor: 1.25 }`
 * - `-`, `NumpadSubtract` → `{ type: 'factor', factor: 0.8 }`
 * - `0`, `Numpad0` → `{ type: 'reset' }`
 * - `null` if `ctrlKey`, `metaKey` or `altKey` is held, or the key is unmapped.
 */
export function zoomKeyAction(e: KeyEventLike): ZoomAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (ZOOM_IN_KEYS.has(e.key) || ZOOM_IN_KEYS.has(e.code)) {
    return { type: 'factor', factor: ZOOM_IN_FACTOR };
  }
  if (ZOOM_OUT_KEYS.has(e.key) || ZOOM_OUT_KEYS.has(e.code)) {
    return { type: 'factor', factor: ZOOM_OUT_FACTOR };
  }
  if (ZOOM_RESET_KEYS.has(e.key) || ZOOM_RESET_KEYS.has(e.code)) {
    return { type: 'reset' };
  }
  return null;
}

/**
 * True for `input`, `textarea`, `select`, or `contenteditable` elements, so
 * space and zoom keys are ignored there (R4).
 *
 * Takes `unknown` rather than `Element | null` to keep this file DOM-free
 * (the ESLint rule forbids the `Element` type). The DOM glue passes the
 * real `Event.target` through.
 */
export function isEditableTarget(target: unknown): boolean {
  if (target === null || typeof target !== 'object') return false;
  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
  };
  if (el.isContentEditable === true) return true;
  const tag = el.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}
