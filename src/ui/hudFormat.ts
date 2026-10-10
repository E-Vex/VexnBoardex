/**
 * HUD formatting — pure, DOM-free (PLAN D-06, R4, R7).
 *
 * Converts camera and cursor state into the four strings the HUD overlay
 * displays. No DOM, no state — just formatting and `screenToWorld` (I-02).
 */

import type { Point } from '../core/geometry';
import { type Camera, screenToWorld } from '../view/camera';

/** The four strings the HUD overlay shows. */
export interface HudStrings {
  zoom: string;
  cam: string;
  world: string;
  screen: string;
}

const DASH = '—';

/**
 * Format a number with exactly one decimal, normalizing "-0.0" to "0.0".
 *
 * Small negatives like -0.04 produce "-0.0" via `toFixed(1)`; the brief
 * (R4) forbids that output, so it is replaced with "0.0". Real negative
 * values (e.g. -0.05 → "-0.1") are left untouched.
 */
function fmt1(n: number): string {
  const s = n.toFixed(1);
  return s === '-0.0' ? '0.0' : s;
}

/**
 * Format a number as an integer string, normalizing -0 to "0".
 * `String(Math.round(-0.1))` already yields "0" in JS, but we are explicit.
 */
function fmtInt(n: number): string {
  const r = Math.round(n);
  return r === 0 ? '0' : String(r);
}

/**
 * Format a zoom level as an integer percent ("100%"), normalizing -0 to "0".
 */
function fmtZoom(z: number): string {
  const pct = Math.round(z * 100);
  return (pct === 0 ? 0 : pct) + '%';
}

/**
 * Returns the four HUD strings for the given camera and cursor position.
 *
 * - `zoom`: integer percent ("100%").
 * - `cam`: "x, y" with one decimal.
 * - `world`: "x, y" with one decimal, or "—" when there is no cursor.
 *   Computed via `screenToWorld` from `view/camera` (I-02), nothing else.
 * - `screen`: "x, y" rounded to integers, or "—" when there is no cursor.
 *
 * "-0.0" and "-0" are never output; they are normalized to "0.0" / "0".
 */
export function formatHud(
  camera: Camera,
  cursorScreen: Point | null,
): HudStrings {
  const zoom = fmtZoom(camera.zoom);
  const cam = `${fmt1(camera.x)}, ${fmt1(camera.y)}`;

  if (cursorScreen === null) {
    return { zoom, cam, world: DASH, screen: DASH };
  }

  const world = screenToWorld(camera, cursorScreen);
  return {
    zoom,
    cam,
    world: `${fmt1(world.x)}, ${fmt1(world.y)}`,
    screen: `${fmtInt(cursorScreen.x)}, ${fmtInt(cursorScreen.y)}`,
  };
}
