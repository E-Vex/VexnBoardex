// T-027 — PNG export e2e tests (M8).
// BLACK BOX (enforced by eslint for e2e/**): nothing from src/ is imported
// here. We drive the toolbar, catch the browser download, then inspect the
// downloaded bytes (PNG signature, IHDR dimensions) and decode the image
// inside the page to probe pixels — the same board colours the on-screen
// canvas shows.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const VIEWPORT = { width: 1280, height: 720 };

/** PNG magic number. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A pixel as an rgba quadruple. */
type Rgba = [number, number, number, number];

function sameColor(a: Rgba, b: Rgba): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/** The board background (theme BG_COLOR) and the default card fill. */
const BG: Rgba = [30, 30, 36, 255];
const CARD_FILL: Rgba = [215, 229, 247, 255];

async function load(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 0');
}

/** Click PNG and return the downloaded file's bytes. */
async function exportPng(page: Page): Promise<{ name: string; bytes: Buffer }> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (path === null) throw new Error('download has no path');
  return { name: download.suggestedFilename(), bytes: readFileSync(path) };
}

/** The IHDR width/height of a PNG buffer (big-endian uint32 at bytes 16/20). */
function pngDimensions(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Decode a PNG (as base64) inside the page and sample two pixels. */
async function samplePngPixels(
  page: Page,
  bytes: Buffer,
): Promise<{ center: Rgba; corner: Rgba }> {
  return page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('PNG failed to decode'));
      img.src = `data:image/png;base64,${b64}`;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0);
    const at = (x: number, y: number) => {
      const d = ctx.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2], d[3]] as [number, number, number, number];
    };
    return {
      center: at(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)),
      corner: at(1, 1),
    };
  }, bytes.toString('base64'));
}

test.describe('PNG export @ 1280×720', () => {
  test.use({ viewport: VIEWPORT });

  test('1. PNG is disabled while the board is empty', async ({ page }) => {
    await load(page);
    await expect(page.getByRole('button', { name: 'PNG', exact: true })).toBeDisabled();
  });

  test('2. PNG downloads the content bounds at 2× with padding', async ({ page }) => {
    await load(page);

    // ＋ Card creates a 200×120 card centred on world (0, 0)
    // (viewport centre — the camera starts centred on the origin).
    await page.getByRole('button', { name: '＋ Card' }).click();
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await expect(page.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled();

    const { name, bytes } = await exportPng(page);

    // Filename: vexboard-<timestamp>.png
    expect(name).toMatch(/^vexboard-\d+\.png$/);

    // It is really a PNG…
    expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    // …of the content bounds + 32 units of padding on every side, at 2×:
    // (200 + 64) × 2 = 528 wide, (120 + 64) × 2 = 368 tall.
    expect(pngDimensions(bytes)).toEqual({ width: 528, height: 368 });

    // Decoded pixels: the centre is the card's fill; the corner (inside the
    // padding, clear of grid dots) is the board background.
    const { center, corner } = await samplePngPixels(page, bytes);
    expect(sameColor(center, CARD_FILL)).toBe(true);
    expect(sameColor(corner, BG)).toBe(true);
  });

  test('3. PNG frames the content, not the current camera', async ({ page }) => {
    await load(page);

    await page.getByRole('button', { name: '＋ Card' }).click();
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');

    // Zoom to 125% and pan far away from the card.
    await page.keyboard.press('Equal');
    await expect(page.getByTestId('hud-zoom')).toHaveText('zoom 125%');
    const canvas = page.locator('canvas');
    await canvas.hover({ position: { x: 400, y: 300 } });
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(480, 340);
    await page.mouse.up({ button: 'middle' });
    await expect(page.getByTestId('hud-cam')).not.toHaveText('cam -640.0, -360.0');

    // The export still frames the card itself: same size, card fill centred.
    const { bytes } = await exportPng(page);
    expect(pngDimensions(bytes)).toEqual({ width: 528, height: 368 });
    const { center, corner } = await samplePngPixels(page, bytes);
    expect(sameColor(center, CARD_FILL)).toBe(true);
    expect(sameColor(corner, BG)).toBe(true);
  });
});
