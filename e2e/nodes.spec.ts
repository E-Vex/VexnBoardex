// T-007 — node creation and camera independence e2e tests.
// BLACK BOX (enforced by eslint `no-restricted-imports` for e2e/**):
// nothing from src/ may be imported here; we only read the HUD DOM and the
// rendered canvas pixels. Sample interior pixels only, never edges.
import { expect, test, type Page } from '@playwright/test';

const VIEWPORT = { width: 1280, height: 720 };
// Camera starts centered on world (0,0): cam = { -640, -360, zoom 1 }.

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

/** The longest contiguous run of `color` pixels in row `y` (device px). */
async function runLengthInRow(
  page: Page,
  y: number,
  color: Rgba,
): Promise<number> {
  return page.locator('canvas').evaluate(
    (el, { y, color: [r, g, b, a] }) => {
      const c = el as HTMLCanvasElement;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      const row = ctx.getImageData(0, y, c.width, 1).data;
      let best = 0;
      let current = 0;
      for (let x = 0; x < c.width; x++) {
        const i = x * 4;
        const isMatch =
          row[i] === r &&
          row[i + 1]! === g &&
          row[i + 2]! === b &&
          row[i + 3]! === a;
        if (isMatch) {
          current++;
          if (current > best) best = current;
        } else {
          current = 0;
        }
      }
      return best;
    },
    { y, color },
  );
}

test.describe('nodes @ 1280×720', () => {
  test.use({ viewport: VIEWPORT });

  test('1. fresh load shows nodes 0', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 0');
  });

  test('2. double-click at (300, 200) creates one card with a visible fill', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 0');
    const bg = await dominantColor(page);

    await page.mouse.dblclick(300, 200);
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');

    // The card fill appears at (300, 230) once the frame is painted
    // (interior point, ~30 px clear of every edge and below the text line).
    let fill: Rgba | null = null;
    await expect
      .poll(async () => {
        const p = await canvasPixel(page, 300, 230);
        if (!sameColor(p, bg)) fill = p;
        return sameColor(p, bg);
      })
      .toBe(false);

    // Interior points across the card share the same fill color…
    const p2 = await canvasPixel(page, 380, 240);
    const p3 = await canvasPixel(page, 220, 240);
    expect(sameColor(fill!, p2)).toBe(true);
    expect(sameColor(fill!, p3)).toBe(true);
    // …which differs from the dominant background color…
    expect(sameColor(fill!, bg)).toBe(false);
    // …and a point outside the card is not that color.
    const outside = await canvasPixel(page, 460, 200);
    expect(sameColor(outside, fill!)).toBe(false);
  });

  test('3. camera changes never touch the document', async ({ page }) => {
    await page.goto('/');
    const bg = await dominantColor(page);

    await page.mouse.dblclick(300, 200);
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    let fill: Rgba | null = null;
    await expect
      .poll(async () => {
        const p = await canvasPixel(page, 300, 230);
        if (!sameColor(p, bg)) fill = p;
        return sameColor(p, bg);
      })
      .toBe(false);
    await page.keyboard.press('Escape'); // close the editor (T-020)

    // Space-drag from (400, 300) to (550, 380): a shift of (150, 80).
    await page.keyboard.down('Space');
    await page.mouse.move(400, 300);
    await page.mouse.down();
    await page.mouse.move(450, 330);
    await page.mouse.move(500, 355);
    await page.mouse.move(550, 380);
    await page.mouse.up();
    await page.keyboard.up('Space');

    // The document is untouched: still one node…
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    // …the card moved with the world: fill at (500, 300)…
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 500, 300), fill!))
      .toBe(true);
    // …and the vacated point (300, 200) is no longer the card fill.
    const vacated = await canvasPixel(page, 300, 200);
    expect(sameColor(vacated, fill!)).toBe(false);

    // Dragging back by the opposite amount restores the fill at (300, 230).
    await page.keyboard.down('Space');
    await page.mouse.move(550, 380);
    await page.mouse.down();
    await page.mouse.move(500, 355);
    await page.mouse.move(450, 330);
    await page.mouse.move(400, 300);
    await page.mouse.up();
    await page.keyboard.up('Space');
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 300, 230), fill!))
      .toBe(true);
  });

  test('4. zoom keeps the card in the world (125% widens the fill run)', async ({
    page,
  }) => {
    await page.goto('/');
    await page.mouse.dblclick(300, 200);
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');

    // Determine the card fill from the interior point (300, 230).
    const bg = await dominantColor(page);
    let fill: Rgba | null = null;
    await expect
      .poll(async () => {
        const p = await canvasPixel(page, 300, 230);
        if (!sameColor(p, bg)) fill = p;
        return sameColor(p, bg);
      })
      .toBe(false);

    // Before zooming, the fill run on row y = 200 is about 200 px wide.
    await expect
      .poll(async () => {
        const run = await runLengthInRow(page, 200, fill!);
        return run >= 196 && run <= 204;
      })
      .toBe(true);
    await page.keyboard.press('Escape'); // close the editor (T-020)

    // Press Equal: 125% around the screen center.
    await page.keyboard.press('Equal');
    await expect(page.getByTestId('hud-zoom')).toHaveText('zoom 125%');

    // After zooming, the run on row y = 200 is about 250 px wide (±2),
    // centred around x ≈ 215 — the same world-space card, drawn wider.
    await expect
      .poll(async () => {
        const run = await runLengthInRow(page, 200, fill!);
        return run >= 248 && run <= 252;
      })
      .toBe(true);
  });

  test('5. two double-clicks create two cards', async ({ page }) => {
    await page.goto('/');
    const bg = await dominantColor(page);

    await page.mouse.dblclick(300, 200);
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    let fill: Rgba | null = null;
    await expect
      .poll(async () => {
        const p = await canvasPixel(page, 300, 230);
        if (!sameColor(p, bg)) fill = p;
        return sameColor(p, bg);
      })
      .toBe(false);

    await page.mouse.dblclick(600, 400);
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');

    // The fill color is found at interior points of both cards.
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 600, 430), fill!))
      .toBe(true);
    expect(sameColor(await canvasPixel(page, 300, 230), fill!)).toBe(true);
  });
});

test.describe('toolbar node creation @ 1280×720', () => {
  test.use({ viewport: VIEWPORT });

  test('6. ＋ Sticky creates a sticky note at the viewport centre (T-019)', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 0');

    await page.getByRole('button', { name: '＋ Sticky' }).click();
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');

    // The sticky is centred on the viewport centre: a fill (not the board
    // background) appears at the centre and its color differs from the bg.
    const bg = await dominantColor(page);
    let fill: Rgba | null = null;
    await expect
      .poll(async () => {
        const p = await canvasPixel(page, 640, 360);
        if (!sameColor(p, bg)) fill = p;
        return sameColor(p, bg);
      })
      .toBe(false);

    // The default sticky is 160×120: the fill extends ±80/±60 around centre.
    expect(sameColor(await canvasPixel(page, 640 + 70, 360), fill!)).toBe(true);
    expect(sameColor(await canvasPixel(page, 640, 360 + 50), fill!)).toBe(true);
    // Outside the note: background again.
    expect(sameColor(await canvasPixel(page, 640 + 100, 360), fill!)).toBe(false);
  });

  test('7. ＋ Text creates a fill-less text node (T-019)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '＋ Text' }).click();
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');

    // A text node paints no fill: a point inside its rect (offset from the
    // world-origin cross marker) stays the board color.
    await page.waitForTimeout(200);
    const bg = await dominantColor(page);
    expect(sameColor(await canvasPixel(page, 648, 368), bg)).toBe(true);

    // It is selected (selection outline) and still a real node.
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 0');
  });
});
