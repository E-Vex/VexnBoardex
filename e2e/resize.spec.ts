// T-021 — resize handles e2e tests.
// BLACK BOX: we drive the page and observe the HUD and canvas pixels.
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

test.describe('resize @ 1280×720', () => {
  test.use({ viewport: VIEWPORT });

  /**
   * Create a card by double-clicking at (300, 200) and close the editor:
   * the card occupies screen 200–400 × 140–260, is selected, and its fill
   * color is returned.
   */
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

  test('1. dragging the SE corner resizes the card in one command', async ({
    page,
  }) => {
    await page.goto('/');
    const fill = await createSelectedCard(page);

    // Drag the SE corner (400, 260) out to (500, 360): +100 × +100.
    await page.mouse.move(400, 260);
    await page.mouse.down();
    await page.mouse.move(450, 310);
    await page.mouse.move(500, 360);
    await page.mouse.up();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');

    // The card now occupies screen 200–500 × 140–360: the new area is fill…
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 480, 340), fill))
      .toBe(true);
    // …and the card is still anchored at its NW corner.
    expect(sameColor(await canvasPixel(page, 210, 150), fill)).toBe(true);
  });

  test('2. dragging the NW corner keeps the SE corner anchored', async ({
    page,
  }) => {
    await page.goto('/');
    const fill = await createSelectedCard(page);

    // Drag the NW corner (200, 140) out to (150, 100): grows by 50 × 40.
    await page.mouse.move(200, 140);
    await page.mouse.down();
    await page.mouse.move(150, 100);
    await page.mouse.up();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');

    // New rect: screen 150–400 × 100–260.
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 160, 110), fill))
      .toBe(true);
    // The SE corner stayed put.
    expect(sameColor(await canvasPixel(page, 390, 250), fill)).toBe(true);
    expect(sameColor(await canvasPixel(page, 145, 95), fill)).toBe(false);
  });

  test('3. Escape cancels the resize: no command, size unchanged', async ({
    page,
  }) => {
    await page.goto('/');
    const fill = await createSelectedCard(page);

    await page.mouse.move(400, 260);
    await page.mouse.down();
    await page.mouse.move(450, 310);
    await page.keyboard.press('Escape');
    await page.mouse.move(500, 360);
    await page.mouse.up();

    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');
    // The card kept its 200×120 size: (390, 250) is still fill, (480, 340)
    // is background.
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 390, 250), fill))
      .toBe(true);
    expect(sameColor(await canvasPixel(page, 480, 340), fill)).toBe(false);
  });

  test('4. undo restores the original geometry in one step', async ({
    page,
  }) => {
    await page.goto('/');
    const fill = await createSelectedCard(page);

    await page.mouse.move(400, 260);
    await page.mouse.down();
    await page.mouse.move(500, 360);
    await page.mouse.up();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 480, 340), fill))
      .toBe(true);

    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    // The card is back to 200×120: (480, 340) is background again.
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 480, 340), fill))
      .toBe(false);
    expect(sameColor(await canvasPixel(page, 390, 250), fill)).toBe(true);
  });
});
