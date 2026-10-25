/**
 * Image cache (T-023, M7) — maps image sources (data URLs) to decoded
 * `HTMLImageElement`s, shared across renders.
 *
 * D-10 says the renderer keeps no state of its own — that refers to
 * *derived* state (doc/view/ui). A decoded-bitmap cache is a resource,
 * like `ctx.measureText`: the renderer remains a pure function of its
 * inputs (the same src always draws the same bitmap); the cache only
 * makes it fast. Loading is asynchronous: `getImage` returns null until
 * the bitmap is decoded, and the caller is notified through the
 * `setImageLoadedCallback` so a re-render is requested.
 */

type LoadedCallback = () => void;

let onLoaded: LoadedCallback | null = null;
const cache = new Map<string, HTMLImageElement>();

/** Set the callback fired when any pending image finishes loading. */
export function setImageLoadedCallback(cb: LoadedCallback): void {
  onLoaded = cb;
}

/**
 * The decoded image for `src`, or null while it is still loading (or has
 * failed — a failed image simply never paints; the placeholder does).
 */
export function getImage(src: string): HTMLImageElement | null {
  let img = cache.get(src);
  if (img === undefined) {
    img = new Image();
    img.onload = () => {
      onLoaded?.();
    };
    img.onerror = () => {
      // Failed loads stay uncached-complete: the placeholder keeps showing.
      onLoaded?.();
    };
    img.src = src;
    cache.set(src, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** Test hook: forget every cached image. */
export function clearImageCache(): void {
  cache.clear();
}
