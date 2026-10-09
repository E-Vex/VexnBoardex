// T-002 — canvas smoke tests.
// BLACK BOX (enforced by eslint `no-restricted-imports` for e2e/**):
// nothing from src/ may be imported here; we only talk to the rendered page.
import { expect, test } from '@playwright/test';

test('page loads clean and has exactly one <canvas>', async ({ page }) => {
  // Listeners are attached before navigation so no early event is missed.
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.goto('/');
  await expect(page.locator('canvas')).toHaveCount(1);
  expect(pageErrors).toHaveLength(0);
  expect(consoleErrors).toHaveLength(0);
});

test.describe('viewport 1280x720 @ dpr 1', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('canvas fills the viewport exactly and there are no scrollbars', async ({
    page,
  }) => {
    await page.goto('/');
    const canvas = page.locator('canvas');

    // Web-first poll: the box must match the viewport (host uses fixed inset 0).
    await expect
      .poll(async () => {
        const b = await canvas.boundingBox();
        return (
          b && [
            Math.round(b.x),
            Math.round(b.y),
            Math.round(b.width),
            Math.round(b.height),
          ]
        );
      })
      .toEqual([0, 0, 1280, 720]);

    const scroll = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      sh: document.documentElement.scrollHeight,
      ch: document.documentElement.clientHeight,
    }));
    expect(scroll.sw).toBeLessThanOrEqual(scroll.cw);
    expect(scroll.sh).toBeLessThanOrEqual(scroll.ch);
  });
});

test.describe('dpr 2', () => {
  test.use({ deviceScaleFactor: 2 });

  test('backing store equals round(css size x dpr)', async ({ page }) => {
    await page.goto('/');
    const canvas = page.locator('canvas');
    await expect
      .poll(async () =>
        canvas.evaluate((el) => {
          const c = el as HTMLCanvasElement;
          const r = c.getBoundingClientRect();
          const dpr = window.devicePixelRatio;
          return [
            c.width,
            c.height,
            Math.round(Math.round(r.width) * dpr),
            Math.round(Math.round(r.height) * dpr),
            dpr,
          ];
        }),
      )
      // default viewport 1280x720 → backing store 2560x1440 at dpr 2
      .toEqual([2560, 1440, 2560, 1440, 2]);
  });
});

test.describe('resize', () => {
  test('canvas box and backing store follow a resize to 800x600', async ({
    page,
  }) => {
    await page.goto('/');
    const canvas = page.locator('canvas');
    // Sanity: initial fill at the default 1280x720 viewport, dpr 1.
    await expect(canvas).toHaveCSS('width', '1280px');

    await page.setViewportSize({ width: 800, height: 600 });
    await expect
      .poll(async () =>
        canvas.evaluate((el) => {
          const c = el as HTMLCanvasElement;
          const r = c.getBoundingClientRect();
          const dpr = window.devicePixelRatio;
          return [
            Math.round(r.width),
            Math.round(r.height),
            c.width,
            c.height,
            Math.round(Math.round(r.width) * dpr),
            Math.round(Math.round(r.height) * dpr),
          ];
        }),
      )
      .toEqual([800, 600, 800, 600, 800, 600]);
  });
});

test('the canvas actually got painted (pixels differ from the background)', async ({
  page,
}) => {
  await page.goto('/');
  const canvas = page.locator('canvas');
  await expect
    .poll(async () =>
      canvas.evaluate((el) => {
        const c = el as HTMLCanvasElement;
        const ctx = c.getContext('2d');
        if (!ctx) return -1;
        const img = ctx.getImageData(0, 0, c.width, c.height).data;
        // Background reference: the very first pixel (top-left corner).
        const bgR = img[0]!;
        const bgG = img[1]!;
        const bgB = img[2]!;
        const bgA = img[3]!;
        let diff = 0;
        for (let i = 4; i < img.length; i += 4) {
          if (
            img[i] !== bgR ||
            img[i + 1] !== bgG ||
            img[i + 2] !== bgB ||
            img[i + 3] !== bgA
          ) {
            diff++;
          }
        }
        return diff;
      }),
    )
    .toBeGreaterThan(0);
});
