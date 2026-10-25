/**
 * Tag filter bar (T-022, M7) — a chip row at the bottom centre listing every
 * tag used in the document. Clicking a chip toggles it in the active filter
 * (`uiStore.tagFilter`); the renderer dims nodes that carry none of the
 * active tags. Pure UI state — never saved, never in history (I-05).
 */

import type { DocStore } from '../core/store';
import type { UiStore } from '../view/uiStore';

const BAR_STYLE = `
  position: fixed;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
  max-width: 70vw;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.75);
  border-radius: 8px;
  font: 13px system-ui, sans-serif;
  color: #e8e8ef;
`;

export interface TagBar {
  destroy(): void;
}

/** Create the tag filter bar; hidden while the document has no tags. */
export function createTagBar(
  docStore: DocStore,
  uiStore: UiStore,
  parent: HTMLElement = document.body,
): TagBar {
  const root = document.createElement('div');
  root.id = 'vex-tag-bar';
  root.style.cssText = BAR_STYLE;
  root.style.display = 'none';
  parent.appendChild(root);

  function render(): void {
    const doc = docStore.get();
    const active = uiStore.get().tagFilter;

    // Every distinct tag in the document, sorted for stable order.
    const tags = [...new Set(Object.values(doc.nodes).flatMap((n) => n.tags))].sort();

    root.innerHTML = '';
    if (tags.length === 0) {
      root.style.display = 'none';
      return;
    }
    root.style.display = 'flex';

    for (const tag of tags) {
      const chip = document.createElement('button');
      chip.dataset.testid = 'filter-chip';
      chip.textContent = tag;
      const isActive = active.includes(tag);
      chip.style.cssText = `
        border: 1px solid ${isActive ? '#f5a623' : 'rgba(255,255,255,0.4)'};
        background: ${isActive ? 'rgba(245, 166, 35, 0.25)' : 'rgba(255,255,255,0.08)'};
        color: #e8e8ef;
        border-radius: 10px;
        padding: 2px 10px;
        cursor: pointer;
        font-size: 12px;
      `;
      chip.onclick = () => {
        const now = uiStore.get().tagFilter;
        uiStore.setTagFilter(
          now.includes(tag) ? now.filter((t) => t !== tag) : [...now, tag],
        );
      };
      root.appendChild(chip);
    }

    // A "clear" chip while any filter is active.
    if (active.length > 0) {
      const clear = document.createElement('button');
      clear.dataset.testid = 'filter-clear';
      clear.textContent = '× clear';
      clear.style.cssText = `
        border: none;
        background: transparent;
        color: #f5a623;
        cursor: pointer;
        font-size: 12px;
        padding: 2px 4px;
      `;
      clear.onclick = () => uiStore.setTagFilter([]);
      root.appendChild(clear);
    }
  }

  docStore.subscribe(() => render());
  uiStore.subscribe(() => render());
  render();

  return {
    destroy() {
      root.remove();
    },
  };
}
