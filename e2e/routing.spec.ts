// T-033 — orthogonal edge routing e2e tests (M9).
// BLACK BOX (enforced by eslint `no-restricted-imports` for e2e/**): nothing
// from src/ is imported; we drive the page (mouse, keyboard), read the HUD
// DOM, the inspector DOM and canvas pixels. Camera starts centred on world
// (0, 0) at zoom 1, so screen = world + (640, 360).
//
// Geometry under test: card A (dblclick at (300, 200)) has its bounding box
// at screen (200, 140)–(400, 260) with its right-side midpoint at (400, 200);
// card B (dblclick at (700, 450)) at screen (600, 390)–(800, 510) with its
// left-side midpoint at (600, 450). Connecting A's right handle to B's body
// creates an edge from (400, 200) whose auto anchor on B resolves to
// (604, 390): the straight arrow runs (400, 200) → (604, 390).
//
// The orthogonal elbow for that edge is (400, 200) → (500, 200) → (500, 450)
// → (600, 450): B's auto anchor snaps to its LEFT midpoint and the
// horizontal→horizontal route bends at the mid-x 500. Every probe below lies
// fully inside its stroke (solid pixels, no anti-aliasing), clear of the
// 24-unit grid dots, of both card rects and of every handle/outline zone.
//
// Selected edges paint in the accent colour #f5a623 (rgb 245, 166, 35),
// unselected ones in #8a8a9a (rgb 138, 138, 154); the background reads
// rgb(30, 30, 36). A 2–3 px stroke through a probe pixel covers it fully,
// so the reads are exact.
//
// Every pixel assertion that observes a CHANGE polls: the canvas repaints
// through requestAnimationFrame after the dispatch (the same rule as
// shapes.spec / mindmap.spec).
import { expect, test, type Page } from '@playwright/test';

const VIEWPORT = { width: 1280, height: 720 };

/** A pixel as an rgba quadruple. */
type Rgba = [number, number, number, number];

/** The unselected edge stroke #8a8a9a. */
const EDGE: Rgba = [138, 138, 154, 255];

/** The selected-edge / selection accent #f5a623. */
const ACCENT: Rgba = [245, 166, 35, 255];

function sameColor(a: Rgba, b: Rgba): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/** Read one canvas pixel (CSS px == device px at DPR 1). */
async function canvasPixel(page: Page, x: number, y: number): Promise<Rgba> {
  return page.locator('canvas').evaluate(
    (el, { x: px, y: py }) => {
      const c = el as HTMLCanvasElement;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      const d = ctx.getImageData(px, py, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!, d[3]!] as [number, number, number, number];
    },
    { x, y },
  );
}

/** Poll until the pixel at `at` satisfies `check` (paints may be pending). */
async function untilPixelIs(
  page: Page,
  at: [number, number],
  check: (p: Rgba) => boolean,
): Promise<void> {
  await expect
    .poll(async () => check(await canvasPixel(page, at[0], at[1])))
    .toBe(true);
}

/**
 * Two cards: A at screen (200, 140)–(400, 260), B at screen (600, 390)–
 * (800, 510), editors closed. `rev` ends at 2.
 */
async function createTwoCards(page: Page): Promise<void> {
  await page.mouse.dblclick(300, 200);
  await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
  await page.keyboard.press('Escape');
  await page.mouse.dblclick(700, 450);
  await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');
}

/**
 * Drag a connection from the handle at `from` to `to` (a release target on
 * the other card's body). The from-card must already be selected.
 */
async function dragConnection(
  page: Page,
  from: [number, number],
  to: [number, number],
): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
  await page.mouse.move(to[0], to[1]);
  await page.mouse.up();
}

/**
 * The board under test: cards A and B connected A→B from A's right handle.
 * The edge's straight arrow runs (400, 200) → (604, 390). `rev` ends at 3.
 */
async function connectedBoard(page: Page): Promise<void> {
  await createTwoCards(page);
  // Select A, then drag from its right handle (400 + 8, 200) to B's body.
  await page.mouse.click(300, 230);
  await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');
  await dragConnection(page, [408, 200], [700, 450]);
  await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
}

// Probe points (see the header comment for the geometry):
/** (534, 325): inside the straight arrow's 2–3 px stroke. */
const ON_STRAIGHT: [number, number] = [534, 325];

/** (590, 377): on the straight arrow near B, clear of its arrowhead. */
const ON_STRAIGHT_NEAR_B: [number, number] = [590, 377];

/** (450, 200): on the elbow's first horizontal leg; background for the straight arrow. */
const FIRST_LEG: [number, number] = [450, 200];

/** (500, 380): on the elbow's vertical middle segment; background for the straight arrow. */
const MID_LEG: [number, number] = [500, 380];

/** (550, 450): on the elbow's last horizontal leg; background for the straight arrow. */
const LAST_LEG: [number, number] = [550, 450];

test.describe('orthogonal edge routing @ 1280×720', () => {
  test.use({ viewport: VIEWPORT });

  test('1. a fresh edge renders the classic arrow; clicking it selects it and opens the route picker', async ({
    page,
  }) => {
    await page.goto('/');
    await connectedBoard(page);
    const bg = await canvasPixel(page, 60, 60);

    // The classic two-point arrow passes exactly through the probe.
    await untilPixelIs(page, ON_STRAIGHT, (p) => sameColor(p, EDGE));

    // Click the arrow at its midpoint: the edge is selected (accent), the
    // node selection is released, and the inspector shows the route picker
    // with Auto active (an absent route IS 'auto').
    await page.mouse.click(...ON_STRAIGHT);
    await untilPixelIs(page, ON_STRAIGHT, (p) => sameColor(p, ACCENT));
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 0');
    await expect(page.locator('#vex-inspector')).toBeVisible();
    for (const route of ['auto', 'straight', 'orthogonal']) {
      await expect(page.getByTestId(`route-${route}`)).toBeVisible();
    }
    await expect(page.getByTestId('route-auto')).toHaveCSS(
      'border-color',
      'rgb(255, 255, 255)',
    );
    await expect(page.getByTestId('route-straight')).toHaveCSS(
      'border-color',
      'rgba(255, 255, 255, 0.4)',
    );
    // Selecting an edge is UI state only — nothing was dispatched.
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    expect(sameColor(await canvasPixel(page, ...ON_STRAIGHT), bg)).toBe(false);
  });

  test('2. orthogonal draws the elbow — one command, probes on all three legs', async ({
    page,
  }) => {
    await page.goto('/');
    await connectedBoard(page);

    // All three elbow probes start as background; the diagonal is inked.
    expect(sameColor(await canvasPixel(page, ...FIRST_LEG), ACCENT)).toBe(false);
    expect(sameColor(await canvasPixel(page, ...MID_LEG), ACCENT)).toBe(false);
    expect(sameColor(await canvasPixel(page, ...LAST_LEG), ACCENT)).toBe(false);
    await untilPixelIs(page, ON_STRAIGHT_NEAR_B, (p) => sameColor(p, EDGE));

    // Select the edge, then pick Orthogonal: rev 3 → 4, exactly ONE command.
    await page.mouse.click(...ON_STRAIGHT);
    await untilPixelIs(page, ON_STRAIGHT, (p) => sameColor(p, ACCENT));
    await page.getByTestId('route-orthogonal').click();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');
    await expect(page.getByTestId('route-orthogonal')).toHaveCSS(
      'border-color',
      'rgb(255, 255, 255)',
    );

    // The elbow appears on all three legs (accent — the edge stays selected)…
    await untilPixelIs(page, FIRST_LEG, (p) => sameColor(p, ACCENT));
    await untilPixelIs(page, MID_LEG, (p) => sameColor(p, ACCENT));
    await untilPixelIs(page, LAST_LEG, (p) => sameColor(p, ACCENT));
    // …and the old diagonal ink is gone.
    await untilPixelIs(page, ON_STRAIGHT_NEAR_B, (p) => !sameColor(p, EDGE));
    expect(
      sameColor(await canvasPixel(page, ...ON_STRAIGHT_NEAR_B), ACCENT),
    ).toBe(false);
  });

  test('3. straight restores the classic arrow exactly', async ({ page }) => {
    await page.goto('/');
    await connectedBoard(page);

    // Route it orthogonal first (rev 4).
    await page.mouse.click(...ON_STRAIGHT);
    await page.getByTestId('route-orthogonal').click();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');
    await untilPixelIs(page, MID_LEG, (p) => sameColor(p, ACCENT));

    // Back to Straight: rev 4 → 5, the elbow disappears, the diagonal returns.
    await page.getByTestId('route-straight').click();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 5');
    await expect(page.getByTestId('route-straight')).toHaveCSS(
      'border-color',
      'rgb(255, 255, 255)',
    );
    await untilPixelIs(page, FIRST_LEG, (p) => !sameColor(p, ACCENT));
    await untilPixelIs(page, MID_LEG, (p) => !sameColor(p, ACCENT));
    await untilPixelIs(page, LAST_LEG, (p) => !sameColor(p, ACCENT));
    await untilPixelIs(page, ON_STRAIGHT_NEAR_B, (p) => sameColor(p, ACCENT));
    await untilPixelIs(page, ON_STRAIGHT, (p) => sameColor(p, ACCENT));
  });

  test('4. undo/redo restore the previous route exactly (one undo step per change)', async ({
    page,
  }) => {
    await page.goto('/');
    await connectedBoard(page);

    await page.mouse.click(...ON_STRAIGHT);
    await page.getByTestId('route-orthogonal').click();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');
    await untilPixelIs(page, MID_LEG, (p) => sameColor(p, ACCENT));

    // Undo un-routes: rev 4 → 5, the diagonal comes back at the same probe.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 5');
    await untilPixelIs(page, MID_LEG, (p) => !sameColor(p, ACCENT));
    await untilPixelIs(page, ON_STRAIGHT_NEAR_B, (p) => sameColor(p, ACCENT));

    // Redo re-routes: rev 5 → 6, the elbow returns.
    await page.keyboard.press('Control+y');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 6');
    await untilPixelIs(page, MID_LEG, (p) => sameColor(p, ACCENT));
    await untilPixelIs(page, ON_STRAIGHT_NEAR_B, (p) => !sameColor(p, ACCENT));
  });

  test('5. Delete removes a selected edge', async ({ page }) => {
    await page.goto('/');
    await connectedBoard(page);

    await page.mouse.click(...ON_STRAIGHT);
    await untilPixelIs(page, ON_STRAIGHT, (p) => sameColor(p, ACCENT));

    // Delete dispatches ONE edge.delete: rev 3 → 4, the ink disappears and
    // the inspector (which keys off live selections) hides.
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');
    await untilPixelIs(page, ON_STRAIGHT, (p) => !sameColor(p, ACCENT));
    await untilPixelIs(page, ON_STRAIGHT_NEAR_B, (p) => !sameColor(p, EDGE));
    await expect(page.locator('#vex-inspector')).toBeHidden();

    // Undo brings the edge (and its ink) back — same patch machinery.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 5');
    await untilPixelIs(page, ON_STRAIGHT, (p) => sameColor(p, EDGE));
  });

  test('6. two edges re-route in ONE edge.update (multi-select via shift-click)', async ({
    page,
  }) => {
    await page.goto('/');
    await createTwoCards(page);

    // Edge 1: A's right handle → B's body (rev 3). Straight arrow
    // (400, 200) → (604, 390), through (534, 325).
    await page.mouse.click(300, 230);
    await dragConnection(page, [408, 200], [700, 450]);
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');

    // Edge 2: B's left handle → A's body — the reverse pair is allowed
    // (rev 4). Straight arrow (600, 450) → (396, 260), through (450, 310) —
    // parallel to edge 1's diagonal, 55+ px away.
    await page.mouse.click(700, 450);
    await dragConnection(page, [592, 450], [300, 200]);
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');
    await untilPixelIs(page, [450, 310], (p) => sameColor(p, EDGE));

    // Select both edges: a plain click on edge 1's diagonal, then a
    // shift-click on edge 2's.
    await page.mouse.click(...ON_STRAIGHT);
    await untilPixelIs(page, ON_STRAIGHT, (p) => sameColor(p, ACCENT));
    await page.keyboard.down('Shift');
    await page.mouse.click(450, 310);
    await page.keyboard.up('Shift');
    await untilPixelIs(page, [450, 310], (p) => sameColor(p, ACCENT));

    // ONE edge.update for both: rev 4 → 5.
    await page.getByTestId('route-orthogonal').click();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 5');

    // Both diagonals are gone; the shared elbow (both edges route along the
    // same A-right↔B-left corridor) is inked on all three legs.
    await untilPixelIs(page, FIRST_LEG, (p) => sameColor(p, ACCENT));
    await untilPixelIs(page, MID_LEG, (p) => sameColor(p, ACCENT));
    await untilPixelIs(page, LAST_LEG, (p) => sameColor(p, ACCENT));
    await untilPixelIs(page, ON_STRAIGHT_NEAR_B, (p) => !sameColor(p, ACCENT));

    // One undo restores BOTH straight arrows at once.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 6');
    await untilPixelIs(page, MID_LEG, (p) => !sameColor(p, ACCENT));
    await untilPixelIs(page, ON_STRAIGHT, (p) => sameColor(p, ACCENT));
    await untilPixelIs(page, [450, 310], (p) => sameColor(p, ACCENT));
  });

  test('7. clicking empty space clears the edge selection and hides the inspector', async ({
    page,
  }) => {
    await page.goto('/');
    await connectedBoard(page);

    await page.mouse.click(...ON_STRAIGHT);
    await expect(page.locator('#vex-inspector')).toBeVisible();
    await expect(page.getByTestId('route-auto')).toBeVisible();

    // A plain click on empty board: no node, no edge — both selections clear.
    await page.mouse.click(100, 600);
    await expect(page.locator('#vex-inspector')).toBeHidden();
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 0');
    await untilPixelIs(page, ON_STRAIGHT, (p) => sameColor(p, EDGE));
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
  });
});
