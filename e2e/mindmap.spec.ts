// T-029 — mind-map mode e2e tests (M9).
// BLACK BOX (enforced by eslint `no-restricted-imports` for e2e/**):
// nothing from src/ is imported; we drive the page (mouse, keyboard), read
// the HUD DOM and probe canvas pixels. Sample interior pixels only, never
// edges. Camera starts centred on world (0, 0) at zoom 1, so
// screen = world + (640, 360) in a 1280×720 viewport.
import { expect, test, type Page } from '@playwright/test';

const VIEWPORT = { width: 1280, height: 720 };

/** The edge stroke colour rendered between two horizontally aligned cards. */
const EDGE: [number, number, number, number] = [138, 138, 154, 255]; // #8a8a9a

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

test.describe('mind-map mode @ 1280×720', () => {
  test.use({ viewport: VIEWPORT });

  /** Switch to mind-map mode, then give focus back to the board. */
  async function enterMindMapMode(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Mode: Select' }).click();
    await expect(page.getByTestId('hud-mode')).toHaveText('mode mindmap');
    // Click empty board space so keystrokes target the page, not the button.
    await page.mouse.click(400, 600);
  }

  /** Plant the root (Tab) and close its editor, keeping it selected. */
  async function plantRoot(page: Page): Promise<void> {
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await page.keyboard.press('Escape');
  }

  /**
   * Poll until the pixel at (x, y) differs from `bg`, then return the new
   * colour — the standard "something was drawn here" probe.
   */
  async function fillAt(page: Page, x: number, y: number): Promise<Rgba> {
    const bg = await dominantColor(page);
    let fill: Rgba | null = null;
    await expect
      .poll(async () => {
        const p = await canvasPixel(page, x, y);
        if (!sameColor(p, bg)) fill = p;
        return sameColor(p, bg);
      })
      .toBe(false);
    return fill!;
  }

  test('1. the toolbar toggle switches the HUD mode both ways', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('hud-mode')).toHaveText('mode select');

    await page.getByRole('button', { name: 'Mode: Select' }).click();
    await expect(page.getByTestId('hud-mode')).toHaveText('mode mindmap');

    await page.getByRole('button', { name: 'Mode: Mind Map' }).click();
    await expect(page.getByTestId('hud-mode')).toHaveText('mode select');
  });

  test('2. Tab on an empty board plants the root at the viewport centre', async ({
    page,
  }) => {
    await page.goto('/');
    await enterMindMapMode(page);
    const bg = await dominantColor(page);

    await page.keyboard.press('Tab');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');

    // The editor opens on the new root with the mind-map default text.
    await expect(page.locator('#vex-text-editor')).toBeVisible();
    await expect(page.locator('#vex-text-editor')).toHaveValue('Idea');

    // The root is centred on world (0, 0): its card fill appears at the
    // viewport centre. Outside probes sit past the connect handles (drawn
    // ~8–16 px outside the selected node's edges), hence ±130, not ±110.
    const fill = await fillAt(page, 640, 360);
    expect(sameColor(fill, bg)).toBe(false);
    expect(sameColor(await canvasPixel(page, 640 + 130, 360), bg)).toBe(true);
    expect(sameColor(await canvasPixel(page, 640 - 130, 360), bg)).toBe(true);
  });

  test('3. Tab grows a child to the right, connected — ONE undo step', async ({
    page,
  }) => {
    await page.goto('/');
    await enterMindMapMode(page);
    const bg = await dominantColor(page);

    await plantRoot(page);
    await page.keyboard.press('Tab'); // child of the root
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
    // One batch command: the revision moved by exactly 1.
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');
    await expect(page.locator('#vex-text-editor')).toBeVisible();
    await page.keyboard.press('Escape');

    // Root fill at the centre; child fill centred at world (280, 0).
    const fill = await fillAt(page, 640, 360);
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 920, 360), fill!))
      .toBe(true);

    // The edge runs along world y = 0 between the root's right edge
    // (screen x = 740) and the child's left edge (screen x = 820). Probe
    // points clear of the 24-unit grid dots (at x = 760, 784, 808).
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 772, 360), EDGE))
      .toBe(true);
    expect(sameColor(await canvasPixel(page, 796, 360), EDGE)).toBe(true);
    // Above the edge line: background (the edge is thin).
    expect(sameColor(await canvasPixel(page, 772, 350), bg)).toBe(true);

    // ONE undo removes the child AND its edge; a second removes the root.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 0');
    // Redo rebuilds the whole tree in two steps.
    await page.keyboard.press('Control+y');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await page.keyboard.press('Control+y');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
  });

  test('4. Enter grows a sibling below the last child — one undo step', async ({
    page,
  }) => {
    await page.goto('/');
    await enterMindMapMode(page);
    const bg = await dominantColor(page);

    await plantRoot(page);
    await page.keyboard.press('Tab'); // child A
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter'); // sibling B of A
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 3');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');
    await page.keyboard.press('Escape');

    // B shares A's column (world x = 180) and starts 40 below A's bottom
    // (world y = 60 + 40 = 100): centre at world (280, 160) → (920, 520).
    const fill = await fillAt(page, 920, 520);
    expect(sameColor(fill, bg)).toBe(false);
    // A is still above it: its fill remains at (920, 360).
    expect(sameColor(await canvasPixel(page, 920, 360), fill!)).toBe(true);

    // ONE undo removes B and its edge together.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
  });

  test('5. F2 still opens the editor; Enter on a parentless node grows a root sibling', async ({
    page,
  }) => {
    await page.goto('/');
    await enterMindMapMode(page);

    await plantRoot(page);

    // F2 opens the editor on the selected root (editing still works).
    await page.keyboard.press('F2');
    await expect(page.locator('#vex-text-editor')).toBeVisible();
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await page.keyboard.press('Escape');

    // Enter on the parentless root grows a disconnected root below it.
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');
    await expect(page.locator('#vex-text-editor')).toBeVisible();
    await page.keyboard.press('Escape');

    // The new root sits 40 below the first: fill centred at (640, 520).
    const bg = await dominantColor(page);
    const fill = await fillAt(page, 640, 520);
    expect(sameColor(fill, bg)).toBe(false);
  });

  test('6. Tab and modified Tab stand down appropriately outside mind-map mode', async ({
    page,
  }) => {
    await page.goto('/');
    await enterMindMapMode(page);
    await plantRoot(page);

    // Back to select mode: Tab must not grow anything.
    await page.getByRole('button', { name: 'Mode: Mind Map' }).click();
    await expect(page.getByTestId('hud-mode')).toHaveText('mode select');
    await page.mouse.click(400, 600); // focus back on the board
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');

    // In select mode Enter with one selected node opens the editor (T-020).
    await page.mouse.click(640, 360); // select the root
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');
    await page.keyboard.press('Enter');
    await expect(page.locator('#vex-text-editor')).toBeVisible();
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await page.keyboard.press('Escape');

    // And in mind-map mode a modified Tab (Shift+) is never a grow.
    await page.getByRole('button', { name: 'Mode: Select' }).click();
    await expect(page.getByTestId('hud-mode')).toHaveText('mode mindmap');
    await page.mouse.click(400, 600);
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
  });

  test('7. Enter while typing commits the text and grows a sibling (T-030)', async ({
    page,
  }) => {
    await page.goto('/');
    await enterMindMapMode(page);
    await plantRoot(page); // rev 1, root selected, editor closed

    // F2 reopens the editor on the root; typing replaces the selected text.
    await page.keyboard.press('F2');
    await expect(page.locator('#vex-text-editor')).toBeVisible();
    await page.keyboard.type('Topic');
    await expect(page.locator('#vex-text-editor')).toHaveValue('Topic');

    // Plain Enter is claimed by the cadence: text commit (rev 2) + sibling
    // root below (rev 3) — and the editor REOPENS on the new sibling.
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');
    await expect(page.locator('#vex-text-editor')).toBeVisible();
    await expect(page.locator('#vex-text-editor')).toHaveValue('Idea');
    await expect(page.locator('#vex-text-editor')).toBeFocused();
    await page.keyboard.press('Escape');

    // The typed text really is in the document: reopen the editor on the
    // root (still centred at (640, 360)) and read it back.
    await page.mouse.click(640, 360);
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');
    await page.keyboard.press('F2');
    await expect(page.locator('#vex-text-editor')).toHaveValue('Topic');
    await page.keyboard.press('Escape');
  });

  test('8. Tab while typing commits and grows a child; undo un-grows before un-typing (T-030)', async ({
    page,
  }) => {
    await page.goto('/');
    await enterMindMapMode(page);
    const bg = await dominantColor(page);
    await plantRoot(page); // rev 1

    await page.keyboard.press('F2');
    await page.keyboard.type('Parent');
    // Plain Tab is claimed too: text commit (rev 2) + child + edge (rev 3).
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    await expect(page.locator('#vex-text-editor')).toHaveValue('Idea');
    await page.keyboard.press('Escape');

    // The child grew to the right of the root, connected (T-029 geometry):
    // its card fill appears centred at world (280, 0) → screen (920, 360).
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 920, 360), bg))
      .toBe(false);

    // First undo removes the child AND its edge — but NOT the typed text.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await page.mouse.click(640, 360); // reselect the root (selection pruned)
    await page.keyboard.press('F2');
    await expect(page.locator('#vex-text-editor')).toHaveValue('Parent');
    await page.keyboard.press('Escape');

    // Second undo reverts the text itself: back to the default. (Undo and
    // redo bump the revision too (D-29), so rev only ever counts up: 5 here.)
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 5');
    await page.keyboard.press('F2');
    await expect(page.locator('#vex-text-editor')).toHaveValue('Idea');
    await page.keyboard.press('Escape');
  });

  test('9. Shift+Enter is still a soft newline; Escape still cancels (T-030)', async ({
    page,
  }) => {
    await page.goto('/');
    await enterMindMapMode(page);
    await plantRoot(page);

    await page.keyboard.press('F2');
    await page.keyboard.type('one');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('two');
    await expect(page.locator('#vex-text-editor')).toHaveValue('one\ntwo');

    // Escape cancels the whole edit: no command, default text intact.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');
    await page.keyboard.press('F2');
    await expect(page.locator('#vex-text-editor')).toHaveValue('Idea');
    await page.keyboard.press('Escape');
  });

  test('10. outside mind-map mode, plain Enter in the editor is still a newline (T-030)', async ({
    page,
  }) => {
    await page.goto('/');
    await enterMindMapMode(page);
    await plantRoot(page);

    // Back to select mode and edit the root with the keyboard.
    await page.getByRole('button', { name: 'Mode: Mind Map' }).click();
    await expect(page.getByTestId('hud-mode')).toHaveText('mode select');
    await page.mouse.click(400, 600); // focus back on the board
    await page.mouse.click(640, 360); // select the root
    await page.keyboard.press('Enter'); // select mode: Enter opens the editor
    await expect(page.locator('#vex-text-editor')).toBeVisible();
    await page.keyboard.type('a');
    await page.keyboard.press('Enter'); // NOT claimed outside mind-map mode
    await expect(page.locator('#vex-text-editor')).toHaveValue('a\n');
    // Nothing was grown and nothing was committed yet.
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');
    await page.keyboard.press('Escape');
  });
});
