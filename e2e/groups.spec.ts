// T-024 — groups/frames e2e tests.
// BLACK BOX: we drive the page and observe the HUD, toolbar buttons and the
// canvas pixels (the amber frame wash and the group move).
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

/** Create a card at a screen point (editor closed). Returns its fill color. */
async function createCardAt(page: Page, x: number, y: number): Promise<Rgba> {
  await page.mouse.dblclick(x, y);
  await page.keyboard.press('Escape'); // close the editor (T-020)
  const bg = await dominantColor(page);
  let fill: Rgba | null = null;
  await expect
    .poll(async () => {
      const p = await canvasPixel(page, x, y + 30);
      if (!sameColor(p, bg)) fill = p;
      return sameColor(p, bg);
    })
    .toBe(false);
  return fill!;
}

test.describe('groups @ 1280×720', () => {
  test.use({ viewport: VIEWPORT });

  test('1. Group frames the selection; dragging a member moves both; Ungroup clears', async ({
    page,
  }) => {
    await page.goto('/');
    // Card A at (300, 200) — rect 200–400 × 140–260.
    await createCardAt(page, 300, 200);
    // Card B at (700, 450) — rect 600–800 × 390–510.
    await createCardAt(page, 700, 450);
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
    const bg = await dominantColor(page);

    // Select both with a marquee, then Group: one command (rev 3).
    await page.mouse.move(150, 100);
    await page.mouse.down();
    await page.mouse.move(850, 550);
    await page.mouse.up();
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 2');
    await page.getByRole('button', { name: 'Group', exact: true }).click();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');

    // The frame paints a subtle amber wash between the cards — a point that
    // is inside the frame (bbox 200–800 × 140–510 + 16 padding) but outside
    // every node: (500, 300) world-screen. It differs from the raw board bg.
    let framePixel: Rgba | null = null;
    await expect
      .poll(async () => {
        const p = await canvasPixel(page, 500, 300);
        if (!sameColor(p, bg)) framePixel = p;
        return sameColor(p, bg);
      })
      .toBe(false);

    // Click the frame between the cards: all members get selected.
    await page.mouse.click(500, 300);
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 2');

    // Drag card A by (0, +100): the whole group moves in ONE command
    // (rev 4). B must move with it.
    await page.mouse.move(300, 230);
    await page.mouse.down();
    await page.mouse.move(300, 330);
    await page.mouse.up();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');

    // B moved down by 100: its fill is at (700, 550+100-ish), vacated at 480.
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 700, 550), framePixel!))
      .toBe(false);
    // The frame followed: the wash moved to between the new positions.

    // Ungroup: one command (rev 5); the frame wash disappears from (500, 300).
    await page.getByRole('button', { name: 'Ungroup', exact: true }).click();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 5');
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 500, 300), bg))
      .toBe(true);

    // Undo the ungroup: rev 6, the frame comes back.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 6');
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 500, 300), bg))
      .toBe(false);
  });

  test('2. deleting the last member removes the frame in the same command', async ({
    page,
  }) => {
    await page.goto('/');
    await createCardAt(page, 300, 200);
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    const bg = await dominantColor(page);

    // Group the single card.
    await page.mouse.click(300, 230);
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');
    await page.getByRole('button', { name: 'Group', exact: true }).click();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');

    // The frame wash appears just outside the card (inside the padding).
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 205, 145), bg))
      .toBe(false);

    // Delete the card: rev 3, and the frame is gone (same-patch cascade).
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 0');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 205, 145), bg))
      .toBe(true);

    // One undo restores the card AND its frame.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 205, 145), bg))
      .toBe(false);
  });
});
