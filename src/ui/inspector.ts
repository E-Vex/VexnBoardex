/**
 * Inspector panel (T-022, M7) — a DOM panel at the top right, shown while
 * nodes or edges are selected: a colour swatch row, a shape picker (T-032,
 * M9) and a tag editor for nodes; a route picker (T-033, M9) for edges.
 *
 * Every change goes through ONE command for the whole selection (I-03):
 * recolouring five nodes is one undo step; re-routing two edges likewise
 * (`edge.update`). The panel itself owns no state — it re-reads doc +
 * selection on every notification.
 */

import type { DocStore } from '../core/store';
import type { Edge, EdgeRoute, Node, NodeShape } from '../core/types';
import type { UiStore } from '../view/uiStore';

/** The preset swatch colours (M7). */
export const SWATCH_COLORS: string[] = [
  '#fef3a2', // sticky yellow
  '#d7e5f7', // pale blue
  '#d4f0db', // mint
  '#f9d5e5', // pink
  '#e5def2', // lavender
  '#fde2cf', // peach
  '#e8e8ee', // light gray
  '#ffffff', // white
];

/** The four flowchart shapes offered by the picker (T-032, M9). */
const SHAPES: { value: NodeShape; label: string }[] = [
  { value: 'rect', label: 'Rect' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'stadium', label: 'Stadium' },
];

/** The three routes offered by the picker (T-033, M9). */
const ROUTES: { value: EdgeRoute; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'straight', label: 'Straight' },
  { value: 'orthogonal', label: 'Orthogonal' },
];

const PANEL_STYLE = `
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.75);
  border-radius: 8px;
  font: 13px system-ui, sans-serif;
  color: #e8e8ef;
  width: 240px;
`;

const SWATCH_STYLE = `
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  cursor: pointer;
  padding: 0;
`;

const SHAPE_BUTTON_STYLE = `
  border: 1px solid rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.1);
  color: #e8e8ef;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 12px;
`;

export interface Inspector {
  destroy(): void;
}

/** Create the inspector; it shows/hides itself with the selection. */
export function createInspector(
  docStore: DocStore,
  uiStore: UiStore,
  parent: HTMLElement = document.body,
): Inspector {
  const root = document.createElement('div');
  root.id = 'vex-inspector';
  root.style.cssText = PANEL_STYLE;
  root.style.display = 'none';
  parent.appendChild(root);

  function render(): void {
    const ui = uiStore.get();
    const doc = docStore.get();
    const nodes = ui.selection
      .map((id) => doc.nodes[id])
      .filter((n): n is NonNullable<typeof n> => n !== undefined);
    const edges = ui.edgeSelection
      .map((id) => doc.edges[id])
      .filter((e): e is NonNullable<typeof e> => e !== undefined);

    root.innerHTML = '';
    if (nodes.length === 0 && edges.length === 0) {
      root.style.display = 'none';
      return;
    }
    root.style.display = 'flex';

    // The selections are mutually exclusive (T-033); nodes take the panel
    // they always had, edges get the route picker.
    if (nodes.length > 0) {
      renderNodeSections(nodes);
      return;
    }
    renderEdgeSection(edges);
  }

  /** The classic node panel: swatches, shape picker, tags. */
  function renderNodeSections(nodes: Node[]): void {

    // ── Colour swatches ──────────────────────────────────────────────────
    const colorLabel = document.createElement('div');
    colorLabel.textContent = 'Color';
    colorLabel.style.opacity = '0.7';
    root.appendChild(colorLabel);

    const swatchRow = document.createElement('div');
    swatchRow.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap;';
    for (const color of SWATCH_COLORS) {
      const btn = document.createElement('button');
      btn.dataset.testid = 'swatch';
      btn.title = color;
      btn.style.cssText = SWATCH_STYLE;
      btn.style.background = color;
      btn.onclick = () => {
        docStore.dispatch({
          type: 'node.update',
          ids: [...uiStore.get().selection],
          patch: { color },
        });
      };
      swatchRow.appendChild(btn);
    }
    root.appendChild(swatchRow);

    // ── Shape picker (T-032, M9) ────────────────────────────────────────
    // One `node.update` for the whole selection — a shape change is content,
    // so it is one undo step for any number of nodes (I-03). The active
    // button is the shape EVERY selected node carries exactly (undefined —
    // the kind's classic outline — leaves none active).
    const shapeLabel = document.createElement('div');
    shapeLabel.textContent = 'Shape';
    shapeLabel.style.opacity = '0.7';
    root.appendChild(shapeLabel);

    const shapeRow = document.createElement('div');
    shapeRow.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap;';
    for (const { value, label } of SHAPES) {
      const active = nodes.every((n) => n.shape === value);
      const btn = document.createElement('button');
      btn.dataset.testid = `shape-${value}`;
      btn.textContent = label;
      btn.title = value;
      btn.style.cssText =
        SHAPE_BUTTON_STYLE +
        (active
          ? '; border-color: #ffffff; background: rgba(255, 255, 255, 0.25);'
          : '');
      btn.onclick = () => {
        docStore.dispatch({
          type: 'node.update',
          ids: [...uiStore.get().selection],
          patch: { shape: value },
        });
      };
      shapeRow.appendChild(btn);
    }
    root.appendChild(shapeRow);

    // ── Tags ─────────────────────────────────────────────────────────────
    const tagLabel = document.createElement('div');
    tagLabel.textContent = 'Tags';
    tagLabel.style.opacity = '0.7';
    root.appendChild(tagLabel);

    const tagRow = document.createElement('div');
    tagRow.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap;';
    // The union of tags across the selection, sorted for stable order.
    const allTags = [...new Set(nodes.flatMap((n) => n.tags))].sort();
    for (const tag of allTags) {
      const chip = document.createElement('button');
      chip.dataset.testid = 'tag-chip';
      chip.textContent = `${tag} ×`;
      chip.style.cssText = `
        border: 1px solid rgba(255,255,255,0.4);
        background: rgba(255,255,255,0.1);
        color: #e8e8ef;
        border-radius: 10px;
        padding: 2px 8px;
        cursor: pointer;
        font-size: 12px;
      `;
      chip.onclick = () => {
        // Remove this tag from every selected node that carries it. Grouped
        // by identical tag arrays so each node.update is well-formed and one
        // undo step covers the whole removal.
        const docNow = docStore.get();
        const byTags = new Map<string, string[]>();
        for (const id of uiStore.get().selection) {
          const node = docNow.nodes[id];
          if (!node || !node.tags.includes(tag)) continue;
          const key = JSON.stringify(node.tags);
          const group = byTags.get(key) ?? [];
          group.push(id);
          byTags.set(key, group);
        }
        for (const [key, ids] of byTags) {
          const tags = JSON.parse(key) as string[];
          docStore.dispatch({
            type: 'node.update',
            ids,
            patch: { tags: tags.filter((t) => t !== tag) },
          });
        }
      };
      tagRow.appendChild(chip);
    }
    root.appendChild(tagRow);

    const input = document.createElement('input');
    input.dataset.testid = 'tag-input';
    input.placeholder = 'Add tag + Enter';
    input.style.cssText = `
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.3);
      border-radius: 4px;
      color: #e8e8ef;
      padding: 4px 8px;
      font-size: 12px;
      outline: none;
    `;
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        input.blur();
        return;
      }
      if (e.key !== 'Enter') return;
      const tag = input.value.trim();
      if (tag === '') return;
      // Add the tag to every selected node that lacks it. One command per
      // distinct tag-set (usually one) keeps each undo step meaningful.
      const docNow = docStore.get();
      const byTags = new Map<string, string[]>();
      for (const id of uiStore.get().selection) {
        const node = docNow.nodes[id];
        if (!node || node.tags.includes(tag)) continue;
        const key = JSON.stringify(node.tags);
        const group = byTags.get(key) ?? [];
        group.push(id);
        byTags.set(key, group);
      }
      for (const [key, ids] of byTags) {
        const tags = JSON.parse(key) as string[];
        docStore.dispatch({
          type: 'node.update',
          ids,
          patch: { tags: [...tags, tag] },
        });
      }
      input.value = '';
    };
    root.appendChild(input);
  }

  /** The edge panel (T-033): one route picker, one `edge.update` for the
   * whole edge selection — the same one-command-one-undo rule the node
   * sections follow. The active button is the route EVERY selected edge
   * effectively takes (an absent route IS 'auto'). */
  function renderEdgeSection(edges: Edge[]): void {
    const routeLabel = document.createElement('div');
    routeLabel.textContent = 'Edge route';
    routeLabel.style.opacity = '0.7';
    root.appendChild(routeLabel);

    const routeRow = document.createElement('div');
    routeRow.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap;';
    for (const { value, label } of ROUTES) {
      // An absent route means 'auto' (I-08) — the effective route decides
      // which button reads as active.
      const active = edges.every((e) => (e.route ?? 'auto') === value);
      const btn = document.createElement('button');
      btn.dataset.testid = `route-${value}`;
      btn.textContent = label;
      btn.title = value;
      btn.style.cssText =
        SHAPE_BUTTON_STYLE +
        (active
          ? '; border-color: #ffffff; background: rgba(255, 255, 255, 0.25);'
          : '');
      btn.onclick = () => {
        docStore.dispatch({
          type: 'edge.update',
          ids: [...uiStore.get().edgeSelection],
          patch: { route: value },
        });
      };
      routeRow.appendChild(btn);
    }
    root.appendChild(routeRow);
  }

  // The × on a chip removes the tag from all selected nodes that have it.
  // (Handled inline above via dispatch; grouped by identical tag arrays so
  // each command is well-formed.)

  docStore.subscribe(() => render());
  uiStore.subscribe(() => render());
  render();

  return {
    destroy() {
      root.remove();
    },
  };
}
