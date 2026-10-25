// T-022 — colors, tags and tag filtering e2e tests.
// BLACK BOX: we drive the page and observe the HUD, DOM panels and pixels.
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

/** Create a selected card (editor closed) at screen (300, 200). */
async function createSelectedCard(page: Page): Promise<Rgba> {
  await page.mouse.dblclick(300, 200);
  await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
  await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');
  await page.keyboard.press('Escape'); // close the editor (T-020)
  const bg = await dominantColor(page);
  let fill: Rgba | null = null;
  await expect
    .poll(async () => {
      const p = await canvasPixel(page, 300, 230);
      if (!sameColor(p, bg)) fill = p;
      return sameColor(p, bg);
    })
    .toBe(false);
  return fill!;
}

test.describe('inspector @ 1280×720', () => {
  test.use({ viewport: VIEWPORT });

  test('1. a swatch click recolors the selection in one command', async ({
    page,
  }) => {
    await page.goto('/');
    const fill = await createSelectedCard(page);

    // The inspector is visible with the selection.
    await expect(page.locator('#vex-inspector')).toBeVisible();

    // Click the mint swatch.
    await page.locator('[data-testid="swatch"]').nth(2).click();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');

    // The card fill changed to the mint swatch color (± antialias on the
    // sampled interior point): sample the exact centre.
    const mint = [212, 240, 219, 255] as Rgba; // #d4f0db
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 300, 230), mint))
      .toBe(true);
    expect(sameColor(await canvasPixel(page, 300, 230), fill)).toBe(false);

    // Deselect: the inspector hides.
    await page.mouse.click(900, 600);
    await expect(page.locator('#vex-inspector')).toBeHidden();
  });

  test('2. tags: add via Enter, filter bar dims non-matching nodes', async ({
    page,
  }) => {
    await page.goto('/');
    // Card A at (300, 200), editor closed, selected.
    const fillA = await createSelectedCard(page);

    // Tag it "idea".
    await page.locator('[data-testid="tag-input"]').fill('idea');
    await page.locator('[data-testid="tag-input"]').press('Enter');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');
    // The chip shows up in the inspector…
    await expect(page.locator('[data-testid="tag-chip"]')).toHaveText('idea ×');
    // …and the tag filter bar appears with the tag.
    await expect(page.locator('#vex-tag-bar')).toBeVisible();
    await expect(page.locator('[data-testid="filter-chip"]')).toHaveText('idea');

    // Card B at (700, 450) — untagged.
    await page.mouse.dblclick(700, 450);
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
    await page.keyboard.press('Escape');
    const bg = await dominantColor(page);
    let fillB: Rgba | null = null;
    await expect
      .poll(async () => {
        const p = await canvasPixel(page, 700, 480);
        if (!sameColor(p, bg)) fillB = p;
        return sameColor(p, bg);
      })
      .toBe(false);

    // Activate the "idea" filter.
    await page.locator('[data-testid="filter-chip"]').first().click();

    // A (tagged) keeps its full fill; B (untagged) dims: the dimmed pixel is
    // a blend of fill and background — neither the full fill nor the bg.
    expect(sameColor(await canvasPixel(page, 300, 230), fillA)).toBe(true);
    const dimmed = await canvasPixel(page, 700, 480);
    expect(sameColor(dimmed, fillB!)).toBe(false);
    expect(sameColor(dimmed, bg)).toBe(false);

    // Clear the filter: B returns to full strength.
    await page.locator('[data-testid="filter-clear"]').click();
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 700, 480), fillB!))
      .toBe(true);
  });

  test('3. removing a tag updates the filter bar and the node', async ({
    page,
  }) => {
    await page.goto('/');
    await createSelectedCard(page);
    await page.locator('[data-testid="tag-input"]').fill('todo');
    await page.locator('[data-testid="tag-input"]').press('Enter');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');
    await expect(page.locator('[data-testid="filter-chip"]')).toHaveText('todo');

    // Remove via the inspector chip: rev 3, and the filter bar empties.
    await page.locator('[data-testid="tag-chip"]').click();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    await expect(page.locator('#vex-tag-bar')).toBeHidden();
  });
});
