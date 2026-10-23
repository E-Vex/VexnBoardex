// T-008 — selection, drag commit, delete and cancel e2e tests.
// BLACK BOX (enforced by eslint `no-restricted-imports` for e2e/**):
// nothing from src/ may be imported here; we only read the HUD DOM and the
// rendered canvas pixels. Sample interior pixels only, never edges.
//
// Setup invariant used throughout: at 1280×720, DPR 1, the camera starts
// centered on world (0, 0) — cam = { -640, -360, zoom 1 } — so a card
// created by double-clicking at screen (300, 200) occupies the screen rect
// x 200–400, y 140–260 (card 200×120 centred on the world point under the
// cursor) and is selected (D-28).
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

/**
 * Create a card by double-clicking at (300, 200) and wait until it is
 * painted: returns its fill color. The card occupies screen x 200–400,
 * y 140–260 and is selected.
 */
async function createCard(page: Page): Promise<Rgba> {
  await page.mouse.dblclick(300, 200);
  await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
  await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');
  await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');

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

test.describe('select @ 1280×720', () => {
  test.use({ viewport: VIEWPORT });

  test('1. select and clear: clicking selects, Shift+empty space clears, rev stays 1', async ({
    page,
  }) => {
    await page.goto('/');
    await createCard(page);

    // Shift+click empty space (800, 500): selection cleared, no command.
    await page.keyboard.down('Shift');
    await page.mouse.click(800, 500);
    await page.keyboard.up('Shift');
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 0');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');

    // Click the card at (300, 230): selected again, still no command.
    await page.mouse.click(300, 230);
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');

    // The document was untouched throughout.
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
  });

  test('2. top-most wins: dragging from the overlap moves B, not A (rev 3)', async ({
    page,
  }) => {
    await page.goto('/');
    const fill = await createCard(page); // card A: x 200–400, y 140–260

    // Card B at (460, 200): x 360–560 — overlaps A on x 360–400.
    await page.mouse.dblclick(460, 200);
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');

    // Click-drag from the overlap point (380, 200) by (0, +200).
    await page.mouse.move(380, 200);
    await page.mouse.down();
    await page.mouse.move(380, 300);
    await page.mouse.move(380, 400);
    await page.mouse.up();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');

    // A did not move: (250, 200) is still card fill…
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 250, 200), fill))
      .toBe(true);
    // …B left: (500, 200) is no longer card fill…
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 500, 200), fill))
      .toBe(false);
    // …and B arrived: (460, 400) is card fill.
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 460, 400), fill))
      .toBe(true);
  });

  test('3. preview vs commit: pointer-move previews, release commits once', async ({
    page,
  }) => {
    await page.goto('/');
    const fill = await createCard(page);

    // Mouse down on the card, drag down 100 px WITHOUT releasing.
    await page.mouse.move(300, 230);
    await page.mouse.down();
    await page.mouse.move(300, 280);
    await page.mouse.move(300, 330);

    // The HUD still shows rev 1 — no command has been dispatched…
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');
    // …but the preview is painted: the card fill moved to (300, 330)…
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 300, 330), fill))
      .toBe(true);
    // …and left its original spot: (390, 150) is no longer card fill.
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 390, 150), fill))
      .toBe(false);

    // Release: exactly one command — rev goes 1 → 2, pixels unchanged.
    await page.mouse.up();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');
    expect(sameColor(await canvasPixel(page, 300, 330), fill)).toBe(true);
    expect(sameColor(await canvasPixel(page, 390, 150), fill)).toBe(false);
  });

  test('4. threshold: a 2.24 px wiggle is a click, not a drag (rev 1)', async ({
    page,
  }) => {
    await page.goto('/');
    const fill = await createCard(page);

    // Down at (300, 230), move to (302, 231) — sqrt(5) ≈ 2.24 < 4 px.
    await page.mouse.move(300, 230);
    await page.mouse.down();
    await page.mouse.move(302, 231);
    await page.mouse.up();

    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');

    // The card is still at its original position.
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 390, 150), fill))
      .toBe(true);
    expect(sameColor(await canvasPixel(page, 300, 230), fill)).toBe(true);
  });

  test('5. zoom-correct drag: world delta at 125% is 80 units (rev 2)', async ({
    page,
  }) => {
    await page.goto('/');
    const fill = await createCard(page);

    // Zoom in 125% around the viewport center, then drag 100 screen px.
    await page.keyboard.press('Equal');
    await expect(page.getByTestId('hud-zoom')).toHaveText('zoom 125%');

    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(300, 200);
    await page.mouse.up();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');

    // Zoom back out to 100%.
    await page.keyboard.press('Minus');
    await expect(page.getByTestId('hud-zoom')).toHaveText('zoom 100%');

    // 100 screen px at zoom 1.25 = 80 world units: the card (originally
    // screen x 200–400 at zoom 1) now occupies x 280–480.
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 210, 230), fill))
      .toBe(false);
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 290, 230), fill))
      .toBe(true);
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 470, 230), fill))
      .toBe(true);
  });

  test('6. delete: Delete and Backspace remove the selection (one command each)', async ({
    page,
  }) => {
    await page.goto('/');
    await createCard(page);

    // Shift+click empty space (800, 500) to clear selection, then Delete → nothing happens.
    await page.keyboard.down('Shift');
    await page.mouse.click(800, 500);
    await page.keyboard.up('Shift');
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 0');
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');

    // Select the card, Delete → gone in one command; selection pruned.
    await page.mouse.click(300, 230);
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 0');
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 0');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');

    // Backspace works the same way.
    await page.mouse.dblclick(300, 200);
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await page.keyboard.press('Backspace');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 0');
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 0');
    // rev: create 1 → delete 2 → create 3 → backspace 4.
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');
  });

  test('7. Escape cancels the drag: no command, card snaps back (rev 1)', async ({
    page,
  }) => {
    await page.goto('/');
    const fill = await createCard(page);

    // Drag down 100 px, press Escape, keep moving, then release.
    await page.mouse.move(300, 230);
    await page.mouse.down();
    await page.mouse.move(300, 280);
    await page.mouse.move(300, 330);
    await page.keyboard.press('Escape');
    await page.mouse.move(300, 380);
    await page.mouse.up();

    // No command was dispatched…
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');
    // …and the card is back at its original position.
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 390, 150), fill))
      .toBe(true);
    expect(sameColor(await canvasPixel(page, 300, 330), fill)).toBe(false);
  });

  test('8. Space-pan over a card: pan wins, selection and doc untouched', async ({
    page,
  }) => {
    await page.goto('/');
    await createCard(page);

    // Deselect first, then pan with Space+left from on top of the card.
    await page.mouse.click(800, 500);
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 0');

    await page.keyboard.down('Space');
    await page.mouse.move(300, 230);
    await page.mouse.down();
    await page.mouse.move(350, 245);
    await page.mouse.move(400, 260);
    await page.mouse.up();
    await page.keyboard.up('Space');

    // Drag of (100, 30): cam −640−100, −360−30.
    await expect(page.getByTestId('hud-cam')).toHaveText('cam -740.0, -390.0');
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 0');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');
  });

  test('9. double-click on a node creates nothing (nodes stays 1)', async ({
    page,
  }) => {
    await page.goto('/');
    await createCard(page);

    // Double-click in the middle of the existing card.
    await page.mouse.dblclick(300, 230);

    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');
  });
});
