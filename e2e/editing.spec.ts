// T-020 — in-place text editing e2e tests.
// BLACK BOX: nothing from src/ is imported; we drive the page (mouse,
// keyboard) and observe the textarea DOM, the HUD and canvas pixels.
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

/** True when any pixel of row `y` between x0 and x1 differs from `fill`. */
async function rowHasInk(
  page: Page,
  y: number,
  x0: number,
  x1: number,
  fill: Rgba,
): Promise<boolean> {
  for (let x = x0; x <= x1; x++) {
    if (!sameColor(await canvasPixel(page, x, y), fill)) return true;
  }
  return false;
}

test.describe('editing @ 1280×720', () => {
  test.use({ viewport: VIEWPORT });

  /** Create a card by double-clicking at (300, 200); the editor opens. */
  async function createCardWithEditor(page: Page): Promise<void> {
    await page.mouse.dblclick(300, 200);
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await expect(page.locator('#vex-text-editor')).toBeVisible();
  }

  test('1. double-click creates a card and opens the editor on it', async ({
    page,
  }) => {
    await page.goto('/');
    await createCardWithEditor(page);

    // The editor is focused with the default text selected.
    await expect(page.locator('#vex-text-editor')).toBeFocused();
    await expect(page.locator('#vex-text-editor')).toHaveValue('New card');

    // Typing does not dispatch anything yet (rev stays at the create).
    await page.keyboard.type('Hello');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
  });

  test('2. Escape cancels: no command, editor closed', async ({ page }) => {
    await page.goto('/');
    await createCardWithEditor(page);
    await page.keyboard.type('Changed');
    await page.keyboard.press('Escape');

    await expect(page.locator('#vex-text-editor')).toBeHidden();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');

    // The card still shows its original text ("New card" ink row present).
    const bg = await dominantColor(page);
    let fill: Rgba | null = null;
    await expect
      .poll(async () => {
        const p = await canvasPixel(page, 300, 230);
        if (!sameColor(p, bg)) fill = p;
        return sameColor(p, bg);
      })
      .toBe(false);
    expect(await rowHasInk(page, 160, 210, 390, fill!)).toBe(true);
  });

  test('3. blur commits exactly one node.update; canvas shows the new text', async ({
    page,
  }) => {
    await page.goto('/');
    await createCardWithEditor(page);
    await page.keyboard.type('World');

    // Click empty space → blur → one command: rev 1 → 2.
    await page.mouse.click(900, 600);
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');
    await expect(page.locator('#vex-text-editor')).toBeHidden();

    // The canvas now draws the new text: dark ink rows inside the card.
    const bg = await dominantColor(page);
    let fill: Rgba | null = null;
    await expect
      .poll(async () => {
        const p = await canvasPixel(page, 300, 230);
        if (!sameColor(p, bg)) fill = p;
        return sameColor(p, bg);
      })
      .toBe(false);
    await expect
      .poll(async () => rowHasInk(page, 160, 210, 390, fill!))
      .toBe(true);

    // Undo is one step: rev 2 → 3 and the document's text is back to
    // "New card" (the exact original — verified by unit tests; here the
    // undo command itself is the observable).
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
  });

  test('4. double-click on an existing node opens the editor on it', async ({
    page,
  }) => {
    await page.goto('/');
    await createCardWithEditor(page);
    await page.keyboard.press('Escape'); // cancel
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');

    // Double-click the card body: the editor opens with its text.
    await page.mouse.dblclick(300, 230);
    await expect(page.locator('#vex-text-editor')).toBeVisible();
    await expect(page.locator('#vex-text-editor')).toHaveValue('New card');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');
    await page.keyboard.press('Escape');
  });

  test('5. Enter with one node selected opens the editor; Delete while typing does not delete', async ({
    page,
  }) => {
    await page.goto('/');
    await page.mouse.dblclick(300, 200);
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await page.keyboard.press('Escape'); // close the auto-opened editor

    // Select the card, then press Enter to edit.
    await page.mouse.click(300, 230);
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');
    await page.keyboard.press('Enter');
    await expect(page.locator('#vex-text-editor')).toBeFocused();

    // Delete while typing is typing, not deleting the node (D-27).
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
  });
});
