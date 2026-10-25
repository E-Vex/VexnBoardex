// T-018 — connection gesture and autosave-restore e2e tests.
// BLACK BOX: nothing from src/ is imported here; we only read the HUD DOM
// and the rendered canvas pixels.
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

test.describe('connect @ 1280×720', () => {
  test.use({ viewport: VIEWPORT });

  test('1. dragging from a handle never displaces the from-node (T-018)', async ({
    page,
  }) => {
    await page.goto('/');
    // Card A at (300, 200) — screen rect 200–400, 140–260, selected…
    await page.mouse.dblclick(300, 200);
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    // …card B at (700, 450) — screen rect 600–800, 390–510.
    await page.mouse.dblclick(700, 450);
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');

    // Reselect A (creating B took the selection).
    await page.mouse.click(300, 230);
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');

    // Sample A's fill before the gesture.
    const bg = await dominantColor(page);
    let fill: Rgba | null = null;
    await expect
      .poll(async () => {
        const p = await canvasPixel(page, 300, 230);
        if (!sameColor(p, bg)) fill = p;
        return sameColor(p, bg);
      })
      .toBe(false);

    // Drag from A's right handle (400, 200 → handle zone ≈ (408, 200))
    // toward B, WITHOUT releasing.
    await page.mouse.move(407, 200);
    await page.mouse.down();
    await page.mouse.move(500, 300);
    await page.mouse.move(650, 420);

    // A never moved (the old renderer offset the from-node by the cursor's
    // absolute world position): its fill is still at (300, 230) and it is
    // still selected (no marquee cleared it).
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 300, 230), fill!))
      .toBe(true);
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');

    // Release on B's body: one edge is created — rev goes 2 → 3.
    await page.mouse.up();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
    // A is still where it was.
    expect(sameColor(await canvasPixel(page, 300, 230), fill!)).toBe(true);
  });

  test('2. reload restores the autosaved board (T-018)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 0');

    await page.mouse.dblclick(300, 200);
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');

    // Wait out the 1s autosave debounce, then reload.
    await page.waitForTimeout(1600);
    await page.reload();

    // The autosaved document (and view) come back: nodes 1, rev 1.
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');
    // Undo is unavailable — replace wiped the history.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');

    // The card is still on screen at its world position.
    const bg = await dominantColor(page);
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 300, 230), bg))
      .toBe(false);

    // New board clears it and the autosave survives a reload.
    await page.getByRole('button', { name: 'New' }).click();
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 0');
    await page.waitForTimeout(300);
    await page.reload();
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 0');
  });
});
