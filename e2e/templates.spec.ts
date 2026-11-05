// T-034 — templates e2e tests (M9).
// BLACK BOX (enforced by eslint `no-restricted-imports` for e2e/**): nothing
// from src/ is imported; we drive the page (mouse, keyboard) and read the
// HUD DOM, the toolbar DOM (template input, buttons, list panel) and canvas
// pixels. Camera starts centred on world (0, 0) at zoom 1.
//
// Saving a template must NOT touch the current document: the revision
// counter (D-29) and the node count stay put, and Undo has nothing to do.
// Applying a template follows the Import semantics (T-018): replace, wipe
// history, bump the revision once. IndexedDB lives as long as the browser
// context, so a reload keeps both the templates store and the autosave —
// the reload test leans on that.
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

/** Poll until the pixel at `at` satisfies `check` (paints may be pending). */
async function untilPixelIs(
  page: Page,
  at: [number, number],
  check: (p: Rgba) => boolean,
): Promise<void> {
  await expect
    .poll(async () => check(await canvasPixel(page, at[0], at[1])))
    .toBe(true);
}

/** Two cards: centres at screen (300, 200) and (700, 450). `rev` ends at 2. */
async function createTwoCards(page: Page): Promise<void> {
  await page.mouse.dblclick(300, 200);
  await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
  await page.keyboard.press('Escape');
  await page.mouse.dblclick(700, 450);
  await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');
}

/** Type a name and click Save as Template. */
async function saveTemplateNamed(page: Page, name: string): Promise<void> {
  await page.getByTestId('template-name-input').fill(name);
  await page.getByTestId('save-template').click();
}

test.describe('templates @ 1280×720', () => {
  test.use({ viewport: VIEWPORT });

  test('1. Save as Template needs a name and never touches the document', async ({
    page,
  }) => {
    await page.goto('/');
    await createTwoCards(page);

    // The guard: no save without a name, and the empty panel says so.
    await expect(page.getByTestId('save-template')).toBeDisabled();
    await page.getByTestId('new-from-template').click();
    await expect(page.getByTestId('template-list')).toBeVisible();
    await expect(page.getByTestId('template-list')).toHaveText(
      'No templates yet.',
    );

    // Saving: one row appears (name — node count)…
    await saveTemplateNamed(page, 'Sprint board');
    await expect(page.getByTestId('template-item')).toHaveText(
      'Sprint board — 2 nodes',
    );
    // …the input clears and the button is disabled again…
    await expect(page.getByTestId('template-name-input')).toHaveValue('');
    await expect(page.getByTestId('save-template')).toBeDisabled();
    // …and the document never moved: same revision, same nodes, same
    // selection (the freshly created card B stays selected — D-28). The
    // revision not moving is the no-history-entry proof — and one Ctrl+Z
    // after saving still un-creates a CARD (nodes 2 → 1), so the save added
    // no undo step of its own.
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
  });

  test('2. New from Template applies the saved document to a fresh board', async ({
    page,
  }) => {
    await page.goto('/');
    await createTwoCards(page);
    const fill = await canvasPixel(page, 300, 200); // card A's fill

    await saveTemplateNamed(page, 'Sprint board');
    await expect(page.getByTestId('template-item')).toHaveText(
      'Sprint board — 2 nodes',
    );

    // Wipe the board with New (rev 2 → 3), then exercise the toggle on the
    // way to a fresh list: close, reopen, apply.
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 0');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    await page.getByTestId('new-from-template').click(); // close
    await expect(page.getByTestId('template-list')).toBeHidden();
    await page.getByTestId('new-from-template').click(); // reopen
    await expect(page.getByTestId('template-item')).toHaveText(
      'Sprint board — 2 nodes',
    );
    await page.getByTestId('template-item').click();

    // The saved document is back: nodes 2, ONE revision bump (rev 3 → 4),
    // history wiped (replace), and card A's ink is exactly where it was.
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');
    await expect(page.getByTestId('template-list')).toBeHidden();
    await untilPixelIs(page, [300, 200], (p) => sameColor(p, fill));
    await expect(page.locator('#vex-toolbar button').filter({ hasText: /Undo/ })).toBeDisabled();
  });

  test('3. a template survives a reload (IndexedDB, like the autosave)', async ({
    page,
  }) => {
    await page.goto('/');
    await createTwoCards(page);
    await saveTemplateNamed(page, 'Sprint board');
    await expect(page.getByTestId('template-item')).toHaveCount(1);

    // Wait out the 1s autosave debounce before reloading (the same rule as
    // connect.spec's restore test), then reload: the autosave restores the
    // board (rev 1, T-018) — the template store must still be there too.
    await page.waitForTimeout(1600);
    await page.reload();
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');
    await page.getByTestId('new-from-template').click();
    await expect(page.getByTestId('template-item')).toHaveText(
      'Sprint board — 2 nodes',
    );

    // New clears the board, the reloaded template still applies.
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 0');
    await page.getByTestId('template-item').click();
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
  });

  test('4. the newest template lists first; × deletes it', async ({ page }) => {
    await page.goto('/');
    await createTwoCards(page);
    await saveTemplateNamed(page, 'Sprint board');

    // A third card, then a second template: newest first.
    await page.mouse.dblclick(500, 200);
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 3');
    await page.keyboard.press('Escape');
    await saveTemplateNamed(page, 'Quick notes');

    const rows = page.getByTestId('template-item');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveText('Quick notes — 3 nodes');
    await expect(rows.nth(1)).toHaveText('Sprint board — 2 nodes');

    // Delete the newest (row 0); the list re-reads the store.
    await page.getByTestId('template-delete').first().click();
    await expect(page.getByTestId('template-item')).toHaveCount(1);
    await expect(page.getByTestId('template-item')).toHaveText(
      'Sprint board — 2 nodes',
    );

    // The surviving template still applies (rev: 2 nodes + 1 card = 3,
    // replace → 4).
    await page.getByTestId('template-item').click();
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');
  });
});
