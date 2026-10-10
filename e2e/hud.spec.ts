// T-004 — HUD and canvas drawing e2e tests.
// BLACK BOX (enforced by eslint `no-restricted-imports` for e2e/**):
// nothing from src/ may be imported here; we only read the HUD DOM and the
// rendered canvas pixels.
import { expect, test } from '@playwright/test';

test.describe('HUD at 1280×720', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('shows zoom 100% and cam -640.0, -360.0 on load', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('hud-zoom')).toHaveText('zoom 100%');
    await expect(page.getByTestId('hud-cam')).toHaveText('cam -640.0, -360.0');
  });

  test('cursor at (300, 200) → screen 300, 200 and world -340.0, -160.0', async ({
    page,
  }) => {
    await page.goto('/');
    const canvas = page.locator('canvas');
    // Move the mouse to (300, 200) relative to the canvas.
    await canvas.hover({ position: { x: 300, y: 200 } });

    await expect(page.getByTestId('hud-screen')).toHaveText('screen 300, 200');
    await expect(page.getByTestId('hud-world')).toHaveText(
      'world -340.0, -160.0',
    );
  });

  test('cam is unchanged after resizing to 800×600', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('hud-cam')).toHaveText(
      'cam -640.0, -360.0',
    );

    await page.setViewportSize({ width: 800, height: 600 });

    // The camera is top-left anchored (R6); resize does not recenter.
    await expect(page.getByTestId('hud-cam')).toHaveText(
      'cam -640.0, -360.0',
    );
  });
});

test('canvas is painted: grid dots and origin marker are visible', async ({
  page,
}) => {
  await page.goto('/');
  const canvas = page.locator('canvas');

  const result = await canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const img = ctx.getImageData(0, 0, c.width, c.height).data;
    const total = img.length / 4;

    // Find the most common colour (the background).
    const colorMap = new Map<string, number>();
    for (let i = 0; i < img.length; i += 4) {
      const key = `${img[i]},${img[i + 1]},${img[i + 2]},${img[i + 3]}`;
      colorMap.set(key, (colorMap.get(key) ?? 0) + 1);
    }
    let bgKey = '';
    let bgCount = 0;
    for (const [key, count] of colorMap) {
      if (count > bgCount) {
        bgCount = count;
        bgKey = key;
      }
    }
    const [bgR, bgG, bgB, bgA] = bgKey.split(',').map(Number);

    // Count pixels that differ from the background.
    let diff = 0;
    for (let i = 0; i < img.length; i += 4) {
      if (
        img[i] !== bgR ||
        img[i + 1] !== bgG ||
        img[i + 2] !== bgB ||
        img[i + 3] !== bgA
      ) {
        diff++;
      }
    }
    const diffPct = (diff / total) * 100;

    // Check a small region around the canvas centre for non-background pixels.
    const cx = Math.floor(c.width / 2);
    const cy = Math.floor(c.height / 2);
    const r = 10;
    let centerDiff = 0;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= c.width || y >= c.height) continue;
        const i = (y * c.width + x) * 4;
        if (
          img[i] !== bgR ||
          img[i + 1] !== bgG ||
          img[i + 2] !== bgB ||
          img[i + 3] !== bgA
        ) {
          centerDiff++;
        }
      }
    }

    return { diffPct, centerDiff };
  });

  expect(result).not.toBeNull();
  // Between 0.05% and 20% of pixels differ from the background.
  expect(result!.diffPct).toBeGreaterThan(0.05);
  expect(result!.diffPct).toBeLessThan(20);
  // A small region around the canvas centre contains non-background pixels
  // (the origin cross marker and the grid dot at world (0, 0)).
  expect(result!.centerDiff).toBeGreaterThan(0);
});
