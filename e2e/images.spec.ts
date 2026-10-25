// T-023 — image nodes e2e tests.
// BLACK BOX: we drive the hidden file input with a tiny PNG and observe the
// HUD and canvas pixels.
import { expect, test, type Page } from '@playwright/test';

const VIEWPORT = { width: 1280, height: 720 };

/** A 16×16 solid red PNG (base64) — big enough to upscale cleanly. */
const RED_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR42mP4z8DwnxLMMGrAqAGjBgwXAwAwxP4QisZM5QAAAABJRU5ErkJggg==';

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

test.describe('images @ 1280×720', () => {
  test.use({ viewport: VIEWPORT });

  test('1. ＋ Image inserts a decoded image node at the centre', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 0');

    // "Pick" a 1×1 red PNG through the hidden input.
    await page.setInputFiles('#vex-image-input', {
      name: 'red.png',
      mimeType: 'image/png',
      buffer: Buffer.from(RED_PNG_BASE64, 'base64'),
    });

    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');

    // A 16×16 image scales up to the 40-unit floor, centred on the viewport:
    // screen 620–660 × 340–380. The bitmap paints red once decoded.
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 640, 360), [255, 0, 0, 255]))
      .toBe(true);
    // Away from the centre but inside the node: still red.
    expect(sameColor(await canvasPixel(page, 645, 365), [255, 0, 0, 255])).toBe(true);
    // Outside the node: the board background.
    const bg = await dominantColor(page);
    expect(sameColor(await canvasPixel(page, 700, 420), bg)).toBe(true);
  });

  test('2. the image survives a reload via the autosave', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#vex-image-input', {
      name: 'red.png',
      mimeType: 'image/png',
      buffer: Buffer.from(RED_PNG_BASE64, 'base64'),
    });
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');

    // Wait out the autosave debounce, then reload.
    await page.waitForTimeout(1600);
    await page.reload();

    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 640, 360), [255, 0, 0, 255]))
      .toBe(true);
  });
});
