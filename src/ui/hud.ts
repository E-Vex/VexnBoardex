/**
 * HUD overlay (T-004 R4, T-007 R9, T-008 R7) — a DOM overlay at the
 * bottom-left showing camera, cursor coordinates, the node count, the
 * selection count and the doc revision. Creates seven lines (`hud-zoom`,
 * `hud-cam`, `hud-world`, `hud-screen`, `hud-nodes`, `hud-selected`,
 * `hud-rev`) and updates them via `formatHud`.
 *
 * The overlay is `pointer-events: none` and `user-select: none` so it never
 * interferes with the canvas.
 */

import type { Point } from '../core/geometry';
import type { Camera } from '../view/camera';
import { formatHud } from './hudFormat';

export interface Hud {
  /** Re-render the seven HUD strings from camera, cursor and counters. */
  update(
    camera: Camera,
    cursorScreen: Point | null,
    nodeCount: number,
    selectedCount: number,
    revision: number,
  ): void;
  destroy(): void;
}

/**
 * Create the HUD overlay and append it to `parent` (default: `document.body`).
 */
export function createHud(parent: HTMLElement = document.body): Hud {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '12px';
  container.style.bottom = '12px';
  container.style.font = '12px monospace';
  container.style.color = '#e8e8ef';
  container.style.background = 'rgba(0, 0, 0, 0.55)';
  container.style.padding = '8px 10px';
  container.style.borderRadius = '4px';
  container.style.lineHeight = '1.5';
  container.style.pointerEvents = 'none';
  container.style.userSelect = 'none';
  container.style.zIndex = '10';

  const zoomEl = document.createElement('div');
  zoomEl.dataset.testid = 'hud-zoom';
  const camEl = document.createElement('div');
  camEl.dataset.testid = 'hud-cam';
  const worldEl = document.createElement('div');
  worldEl.dataset.testid = 'hud-world';
  const screenEl = document.createElement('div');
  screenEl.dataset.testid = 'hud-screen';
  const nodesEl = document.createElement('div');
  nodesEl.dataset.testid = 'hud-nodes';
  const selectedEl = document.createElement('div');
  selectedEl.dataset.testid = 'hud-selected';
  const revEl = document.createElement('div');
  revEl.dataset.testid = 'hud-rev';

  container.append(zoomEl, camEl, worldEl, screenEl, nodesEl, selectedEl, revEl);
  parent.append(container);

  return {
    update(camera, cursorScreen, nodeCount, selectedCount, revision) {
      const s = formatHud(camera, cursorScreen, nodeCount, selectedCount, revision);
      zoomEl.textContent = `zoom ${s.zoom}`;
      camEl.textContent = `cam ${s.cam}`;
      worldEl.textContent = `world ${s.world}`;
      screenEl.textContent = `screen ${s.screen}`;
      nodesEl.textContent = `nodes ${s.nodes}`;
      selectedEl.textContent = `selected ${s.selected}`;
      revEl.textContent = `rev ${s.rev}`;
    },
    destroy() {
      container.remove();
    },
  };
}
