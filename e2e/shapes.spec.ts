// T-032 — flowchart shapes e2e tests (M9).
// BLACK BOX (enforced by eslint `no-restricted-imports` for e2e/**):
// nothing from src/ is imported; we drive the page (mouse, keyboard), read
// the HUD DOM, the inspector DOM and canvas pixels. Camera starts centred
// on world (0, 0) at zoom 1, so screen = world + (640, 360).
//
// Geometry under test: a card created by double-click at screen (300, 200)
// has its bounding box at screen (200, 140)–(400, 260) — w 200, h 120. The
// probe points are chosen clear of the 8×8 corner resize handles (which
// cover 196–204 × 136–144 etc.), clear of the 1-unit border strokes, above
// the first text line (y 152–173) and off the 24-unit grid dots.
//
// Every pixel assertion that observes a CHANGE polls: the canvas repaints
// through requestAnimationFrame after the dispatch, so a one-shot read can
// race the old frame (the same rule as mindmap.spec's fillAt).
import { expect, test, type Page } from '@playwright/test';

const VIEWPORT = { width: 1280, height: 720 };

/** A pixel as an rgba quadruple. */
type Rgba = [number, number, number, number];

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

/** The dominant (most frequent) canvas color — the board background. */
async function dominantColor(page: Page): Promise<Rgba> {
  return page.locator('canvas').evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    const img = ctx.getImageData(0, 0, c.width, c.height).data;
    const counts = new Map<string, number>();
    for (let i = 0; i < img.length; i += 4) {
      const key = `${img[i]},${img[i + 1]},${img[i + 2]},${img[i + 3]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let bestKey = '';
    let bestCount = -1;
    for (const [key, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        bestKey = key;
      }
    }
    return bestKey.split(',').map(Number) as [number, number, number, number];
  });
}

/**
 * Create a selected card (editor closed) whose bounding box sits at screen
 * (200, 140)–(400, 260); returns its fill colour probed at the centre.
 */
async function createSelectedCard(page: Page): Promise<Rgba> {
  await page.mouse.dblclick(300, 200);
  await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
  await page.keyboard.press('Escape'); // close the editor (T-020)
  let fill: Rgba | null = null;
  await expect
    .poll(async () => {
      const p = await canvasPixel(page, 300, 200);
      if (!sameColor(p, [0, 0, 0, 0])) fill = p;
      return fill === null;
    })
    .toBe(false);
  return fill!;
}

/**
 * The corner probe (T-032): pixel (203, 146) sits 3 px in from the top-left
 * of the card's bounding box. The classic card corner (r 8) and the sharp
 * `rect` cover it; `rounded` (r 16), `stadium` (r 60) and the diamond cut
 * it away. Clear of the resize handle (ends at y 144.5) and of the border
 * stroke.
 */
const CORNER: [number, number] = [203, 146];

/** Pixel (213, 147): inside `rounded`, outside `stadium` and the diamond. */
const ROUNDED_ONLY: [number, number] = [213, 147];

/** Pixel (300, 150): just below the diamond's top vertex — inside it. */
const DIAMOND_TOP: [number, number] = [300, 150];

/** Pixel (205, 200): the left-middle zone — inside every shape's fill. */
const LEFT_MID: [number, number] = [205, 200];

/** Click an inspector shape button. */
async function setShape(
  page: Page,
  shape: 'rect' | 'rounded' | 'diamond' | 'stadium',
): Promise<void> {
  await page.getByTestId(`shape-${shape}`).click();
}

test.describe('flowchart shapes @ 1280×720', () => {
  test.use({ viewport: VIEWPORT });

  test('1. a fresh card renders the classic outline (no shape set)', async ({
    page,
  }) => {
    await page.goto('/');
    const fill = await createSelectedCard(page);
    const bg = await dominantColor(page);

    // The classic rounded-corner card still covers the corner probe, and
    // the inspector offers all four shape buttons with none active.
    expect(sameColor(await canvasPixel(page, ...CORNER), fill)).toBe(true);
    expect(sameColor(await canvasPixel(page, ...LEFT_MID), fill)).toBe(true);
    for (const shape of ['rect', 'rounded', 'diamond', 'stadium']) {
      await expect(page.getByTestId(`shape-${shape}`)).toBeVisible();
      await expect(page.getByTestId(`shape-${shape}`)).toHaveCSS(
        'border-color',
        'rgba(255, 255, 255, 0.4)',
      );
    }
    // Nothing was dispatched beyond the creation.
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');
    expect(sameColor(await canvasPixel(page, ...CORNER), bg)).toBe(false);
  });

  test('2. Rounded cuts the corners — one command, undo restores', async ({
    page,
  }) => {
    await page.goto('/');
    const fill = await createSelectedCard(page);

    await setShape(page, 'rounded');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');
    // The corner is cut away (border or background — anything but the fill).
    await untilPixelIs(page, CORNER, (p) => !sameColor(p, fill));
    // A point well inside the rounded outline is still fill.
    expect(sameColor(await canvasPixel(page, ...ROUNDED_ONLY), fill)).toBe(
      true,
    );
    // The Rounded button is the active one now.
    await expect(page.getByTestId('shape-rounded')).toHaveCSS(
      'border-color',
      'rgb(255, 255, 255)',
    );

    // Undo restores the classic outline exactly (one undo step).
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    await untilPixelIs(page, CORNER, (p) => sameColor(p, fill));
  });

  test('3. Stadium rounds the ends fully', async ({ page }) => {
    await page.goto('/');
    const fill = await createSelectedCard(page);

    await setShape(page, 'stadium');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');
    // Both the corner AND the rounded-only point are cut away…
    await untilPixelIs(page, CORNER, (p) => !sameColor(p, fill));
    expect(sameColor(await canvasPixel(page, ...ROUNDED_ONLY), fill)).toBe(
      false,
    );
    // …while the left-middle zone (the semicircular end's centre line) fills.
    expect(sameColor(await canvasPixel(page, ...LEFT_MID), fill)).toBe(true);
    expect(sameColor(await canvasPixel(page, 300, 200), fill)).toBe(true);
  });

  test('4. Diamond draws a decision rhombus', async ({ page }) => {
    await page.goto('/');
    const fill = await createSelectedCard(page);

    await setShape(page, 'diamond');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');
    // The corners and the upper-left zone are cut away…
    await untilPixelIs(page, CORNER, (p) => !sameColor(p, fill));
    expect(sameColor(await canvasPixel(page, ...ROUNDED_ONLY), fill)).toBe(
      false,
    );
    // …but just below the top vertex and at the centre the rhombus fills.
    expect(sameColor(await canvasPixel(page, ...DIAMOND_TOP), fill)).toBe(true);
    expect(sameColor(await canvasPixel(page, 300, 200), fill)).toBe(true);
  });

  test('5. Rect is the sharp process box (distinct from the classic card)', async ({
    page,
  }) => {
    await page.goto('/');
    const fill = await createSelectedCard(page);

    // Via Rounded first, so the sharp corners have a visible before-state.
    await setShape(page, 'rounded');
    await untilPixelIs(page, CORNER, (p) => !sameColor(p, fill));
    await setShape(page, 'rect');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    // Sharp corners: the corner probe is fill again.
    await untilPixelIs(page, CORNER, (p) => sameColor(p, fill));
    expect(sameColor(await canvasPixel(page, 300, 200), fill)).toBe(true);
  });

  test('6. a multi-selection reshapes every node in ONE command', async ({
    page,
  }) => {
    await page.goto('/');
    const fill = await createSelectedCard(page);

    // A second card, bbox at screen (600, 140)–(800, 260).
    await page.mouse.dblclick(700, 200);
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
    await page.keyboard.press('Escape');

    // Select both (click one, shift-click the other — T-016).
    await page.mouse.click(300, 200);
    await page.keyboard.down('Shift');
    await page.mouse.click(700, 200);
    await page.keyboard.up('Shift');
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 2');

    const revBefore = 2; // two creations
    await expect(page.getByTestId('hud-rev')).toHaveText(`rev ${revBefore}`);
    await setShape(page, 'diamond');
    // ONE node.update for the whole selection: rev moved by exactly 1.
    await expect(page.getByTestId('hud-rev')).toHaveText(
      `rev ${revBefore + 1}`,
    );

    // Both cards are diamonds now (corners cut on each).
    await untilPixelIs(page, CORNER, (p) => !sameColor(p, fill));
    await untilPixelIs(page, [603, 146], (p) => !sameColor(p, fill));
    // …and one undo restores both classic outlines at once.
    await page.keyboard.press('Control+z');
    await untilPixelIs(page, CORNER, (p) => sameColor(p, fill));
    await untilPixelIs(page, [603, 146], (p) => sameColor(p, fill));
  });

  test('7. the text-editor overlay mirrors the shape while editing', async ({
    page,
  }) => {
    await page.goto('/');
    await createSelectedCard(page);

    // Diamond: the overlay is clipped to the rhombus and its text box is
    // inset to the inscribed rectangle (the same geometry as the renderer).
    await setShape(page, 'diamond');
    await page.keyboard.press('F2');
    await expect(page.locator('#vex-text-editor')).toBeVisible();
    const diamondClip = await page
      .locator('#vex-text-editor')
      .evaluate((el) => getComputedStyle(el).clipPath);
    expect(diamondClip).toContain('polygon');
    await page.keyboard.press('Escape');

    // Stadium: fully-rounded ends — radius = half the shorter side (60 px).
    await setShape(page, 'stadium');
    await page.keyboard.press('F2');
    await expect(page.locator('#vex-text-editor')).toBeVisible();
    await expect(page.locator('#vex-text-editor')).toHaveCSS(
      'border-radius',
      '60px',
    );
    await page.keyboard.press('Escape');
  });
});
