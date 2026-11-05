// T-035 — kanban columns and card snapping e2e tests (M9).
// BLACK BOX (enforced by eslint `no-restricted-imports` for e2e/**):
// nothing from src/ is imported; we drive the page (mouse, keyboard), read
// the HUD DOM and probe canvas pixels. Sample interior pixels only, never
// edges. Camera starts centred on world (0, 0) at zoom 1, so
// screen = world + (640, 360) in a 1280×720 viewport.
//
// Board geometry (planKanbanBoard centred on the viewport centre): three
// 240×400 columns with a 40 gap — To Do world x [-400, -160], Doing
// [-120, 120], Done [160, 400], all y [-200, 200]. On screen:
// To Do [240, 480], Doing [520, 760], Done [800, 1040], y [160, 560].
// Card slots: x = column.x + 16, slot 0 y = column.y + 52 (header 36 +
// padding 16); a default card is 200×120, so slot 1 sits 132 lower.
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

/** Poll until the pixel at (x, y) is NOT the board background. */
async function expectPainted(page: Page, x: number, y: number): Promise<void> {
  const bg = await dominantColor(page);
  await expect
    .poll(async () => sameColor(await canvasPixel(page, x, y), bg))
    .toBe(false);
}

/** Poll until the pixel at (x, y) IS the board background again. */
async function expectCleared(page: Page, x: number, y: number): Promise<void> {
  const bg = await dominantColor(page);
  await expect
    .poll(async () => sameColor(await canvasPixel(page, x, y), bg))
    .toBe(true);
}

/** The column panel colour, sampled from a painted panel interior. */
async function panelColor(page: Page): Promise<Rgba> {
  return canvasPixel(page, TODO_PANEL[0], TODO_PANEL[1]);
}

/** Poll until the pixel at (x, y) shows the column PANEL again — an empty
 * slot inside a column paints the panel wash, not the bare background. */
async function expectPanel(page: Page, x: number, y: number): Promise<void> {
  const panel = await panelColor(page);
  await expect
    .poll(async () => sameColor(await canvasPixel(page, x, y), panel))
    .toBe(true);
}

/** Poll until the pixel at (x, y) is something OTHER than the panel — a
 * card fill (the only content that paints inside a column body). */
async function expectCard(page: Page, x: number, y: number): Promise<void> {
  const panel = await panelColor(page);
  await expect
    .poll(async () => sameColor(await canvasPixel(page, x, y), panel))
    .toBe(false);
}

// Panel interiors (clear of the border, the header text, the × and every
// 24-unit grid dot — dots sit at world multiples of 24).
const TODO_PANEL: [number, number] = [250, 510]; // world (-390, 150)
const DOING_PANEL: [number, number] = [550, 510]; // world (-90, 150)
const DONE_PANEL: [number, number] = [820, 510]; // world (180, 150)

// Card fill probes (interior, below the one-line text).
const TODO_SLOT0: [number, number] = [400, 310]; // world (-240, -50)
const TODO_SLOT1: [number, number] = [400, 442]; // world (-240, 82)
const DOING_SLOT0: [number, number] = [680, 310]; // world (40, -50)

/** Card centres (press/release points for drags and clicks). */
const TODO_SLOT0_CENTRE: [number, number] = [356, 272];
const TODO_SLOT1_CENTRE: [number, number] = [356, 404];
const DOING_SLOT0_CENTRE: [number, number] = [636, 272];

/** The × close affordance of the To Do column (world (-176, -182)). */
const TODO_CLOSE: [number, number] = [464, 178];

/** Create the To Do / Doing / Done board: ONE revision, zero nodes. */
async function createBoard(page: Page): Promise<void> {
  await page.getByRole('button', { name: '＋ Kanban' }).click();
  await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');
  await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 0');
}

/** Double-click inside the To Do column's slot-0 area and commit text. */
async function createCardInTodo(
  page: Page,
  at: [number, number],
  text?: string,
): Promise<void> {
  await page.mouse.dblclick(at[0], at[1]);
  await expect(page.locator('#vex-text-editor')).toBeVisible();
  if (text !== undefined) {
    await page.keyboard.type(text);
    await page.keyboard.press('Control+Enter'); // commit (blur also commits)
  } else {
    await page.keyboard.press('Escape'); // cancel: default text stands
  }
}

test.describe('kanban — columns and card snapping @ 1280×720', () => {
  test.use({ viewport: VIEWPORT });

  test('1. ＋ Kanban paints To Do / Doing / Done as ONE undo step', async ({
    page,
  }) => {
    await page.goto('/');
    await createBoard(page);

    // Three panels, each a wash over the background.
    await expectPainted(page, TODO_PANEL[0], TODO_PANEL[1]);
    await expectPainted(page, DOING_PANEL[0], DOING_PANEL[1]);
    await expectPainted(page, DONE_PANEL[0], DONE_PANEL[1]);
    // Left of the board is untouched background.
    const bg = await dominantColor(page);
    expect(sameColor(await canvasPixel(page, 200, 360), bg)).toBe(true);

    // ONE undo removes the whole board (the batch is one history entry).
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');
    await expectCleared(page, TODO_PANEL[0], TODO_PANEL[1]);
    await expectCleared(page, DONE_PANEL[0], DONE_PANEL[1]);
    // Redo brings it back.
    await page.keyboard.press('Control+y');
    await expectPainted(page, TODO_PANEL[0], TODO_PANEL[1]);
  });

  test('2. a double-click inside a column creates the card seated in its slot', async ({
    page,
  }) => {
    await page.goto('/');
    await createBoard(page);

    await createCardInTodo(page, [356, 250]); // upper area of slot 0
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    // Board + ONE batch (create + membership): rev 2, not 3.
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');

    // The card sits at To Do's slot 0 (screen 256–456 × 212–332).
    await expectCard(page, TODO_SLOT0[0], TODO_SLOT0[1]);
    // Below the card is the column PANEL (not another card, not the bare
    // background): slot 1 is empty and the card ends at y 332.
    await expectPanel(page, 400, 340);
    await expectPanel(page, TODO_SLOT1[0], TODO_SLOT1[1]);

    // ONE undo removes the card (the batch is one history entry).
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 0');
    await expectPanel(page, TODO_SLOT0[0], TODO_SLOT0[1]);
  });

  test('3. dragging a card onto another column snaps it there — one undo restores', async ({
    page,
  }) => {
    await page.goto('/');
    await createBoard(page);
    await createCardInTodo(page, [356, 250]);

    // Drag the card from To Do's slot 0 to Doing's slot 0.
    await page.mouse.move(TODO_SLOT0_CENTRE[0], TODO_SLOT0_CENTRE[1]);
    await page.mouse.down();
    await page.mouse.move(DOING_SLOT0_CENTRE[0], DOING_SLOT0_CENTRE[1], {
      steps: 10,
    });
    await page.mouse.up();

    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    // The card fill now lives in Doing's slot 0 (screen 536–736 × 212–332).
    await expectCard(page, DOING_SLOT0[0], DOING_SLOT0[1]);
    // …and To Do's slot 0 is empty panel again.
    await expectPanel(page, TODO_SLOT0[0], TODO_SLOT0[1]);
    // The emptied To Do column survives (empty columns are the default).
    await expectPainted(page, TODO_PANEL[0], TODO_PANEL[1]);

    // ONE undo returns the card to To Do's slot 0.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');
    await expectCard(page, TODO_SLOT0[0], TODO_SLOT0[1]);
    await expectPanel(page, DOING_SLOT0[0], DOING_SLOT0[1]);
  });

  test('4. dragging a card below its neighbour swaps their slots', async ({
    page,
  }) => {
    await page.goto('/');
    await createBoard(page);
    // Card A at slot 0, card B at slot 1 — typed names make the order
    // observable through the editor (the fills are identical). Each card
    // costs TWO revisions: the creation batch and its text commit.
    await createCardInTodo(page, [356, 250], 'A');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    await createCardInTodo(page, [356, 400], 'B'); // below A → slot 1
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 5');

    // Drag A (slot 0) below B: A's centre lands at world y 90 > B's 44.
    await page.mouse.move(TODO_SLOT0_CENTRE[0], TODO_SLOT0_CENTRE[1]);
    await page.mouse.down();
    await page.mouse.move(356, 450, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 6');

    // Slot 0 now holds B; slot 1 holds A.
    await page.mouse.click(TODO_SLOT0_CENTRE[0], TODO_SLOT0_CENTRE[1]);
    await page.keyboard.press('F2');
    await expect(page.locator('#vex-text-editor')).toHaveValue('B');
    await page.keyboard.press('Escape');
    await page.mouse.click(TODO_SLOT1_CENTRE[0], TODO_SLOT1_CENTRE[1]);
    await page.keyboard.press('F2');
    await expect(page.locator('#vex-text-editor')).toHaveValue('A');
    await page.keyboard.press('Escape');

    // Both slots are filled after the swap (and only those two): the area
    // below slot 1 is empty panel again (probe clear of the 24-unit grid
    // dots — world (-238, 130) is between dot intersections).
    await expectCard(page, TODO_SLOT0[0], TODO_SLOT0[1]);
    await expectCard(page, TODO_SLOT1[0], TODO_SLOT1[1]);
    await expectPanel(page, 402, 490);

    // ONE undo restores the original order.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 7');
    await page.mouse.click(TODO_SLOT0_CENTRE[0], TODO_SLOT0_CENTRE[1]);
    await page.keyboard.press('F2');
    await expect(page.locator('#vex-text-editor')).toHaveValue('A');
    await page.keyboard.press('Escape');
  });

  test('5. dragging a card out of the columns frees it; the column survives', async ({
    page,
  }) => {
    await page.goto('/');
    await createBoard(page);
    await createCardInTodo(page, [356, 250]);

    // Drag the card far below every column (outside all of them).
    await page.mouse.move(TODO_SLOT0_CENTRE[0], TODO_SLOT0_CENTRE[1]);
    await page.mouse.down();
    await page.mouse.move(356, 650, { steps: 10 });
    await page.mouse.up();

    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    // The card stays where it was dropped (raw position, screen y 590–710) —
    // outside every column, so the probe compares against the background.
    await expectPainted(page, 400, 680);
    // To Do survives the loss — its panel is still painted.
    await expectPainted(page, TODO_PANEL[0], TODO_PANEL[1]);

    // ONE undo seats the card back in To Do's slot 0.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');
    await expectPainted(page, TODO_SLOT0[0], TODO_SLOT0[1]);
    const bg = await dominantColor(page);
    expect(sameColor(await canvasPixel(page, 400, 680), bg)).toBe(true);
  });

  test('6. the × on a column header deletes the column; its cards survive', async ({
    page,
  }) => {
    await page.goto('/');
    await createBoard(page);
    await createCardInTodo(page, [356, 250]);

    // Click the To Do column's ×.
    await page.mouse.click(TODO_CLOSE[0], TODO_CLOSE[1]);
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    // The column is gone…
    await expectCleared(page, TODO_PANEL[0], TODO_PANEL[1]);
    // …but the card survives, ungrouped, exactly where it was.
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await expectPainted(page, TODO_SLOT0[0], TODO_SLOT0[1]);
    // The other columns are untouched.
    await expectPainted(page, DOING_PANEL[0], DOING_PANEL[1]);

    // ONE undo restores the column AND the card's membership.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');
    await expectPainted(page, TODO_PANEL[0], TODO_PANEL[1]);
    // The card is a member again: drag it to Doing and undo — the round
    // trip only behaves like a member move when both columns exist.
    await page.mouse.move(TODO_SLOT0_CENTRE[0], TODO_SLOT0_CENTRE[1]);
    await page.mouse.down();
    await page.mouse.move(DOING_SLOT0_CENTRE[0], DOING_SLOT0_CENTRE[1], {
      steps: 10,
    });
    await page.mouse.up();
    await expectPainted(page, DOING_SLOT0[0], DOING_SLOT0[1]);
  });

  test('7. deleting the last card leaves an empty column behind', async ({
    page,
  }) => {
    await page.goto('/');
    await createBoard(page);
    await createCardInTodo(page, [356, 250]);

    // Select and delete the card.
    await page.mouse.click(TODO_SLOT0_CENTRE[0], TODO_SLOT0_CENTRE[1]);
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 0');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');

    // The column did NOT cascade away with its last card.
    await expectPainted(page, TODO_PANEL[0], TODO_PANEL[1]);
    // ONE undo restores card AND its membership.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await expectPainted(page, TODO_SLOT0[0], TODO_SLOT0[1]);
  });

  test('8. the board and its cards survive a reload (autosave, T-018)', async ({
    page,
  }) => {
    await page.goto('/');
    await createBoard(page);
    await createCardInTodo(page, [356, 250], 'Task');

    // Wait out the 1s autosave debounce, then reload.
    await page.waitForTimeout(1600);
    await page.reload();

    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');
    // The columns and the seated card are restored.
    await expectPainted(page, TODO_PANEL[0], TODO_PANEL[1]);
    await expectPainted(page, DOING_PANEL[0], DOING_PANEL[1]);
    await expectPainted(page, TODO_SLOT0[0], TODO_SLOT0[1]);
    // The typed text survived too.
    await page.mouse.click(TODO_SLOT0_CENTRE[0], TODO_SLOT0_CENTRE[1]);
    await page.keyboard.press('F2');
    await expect(page.locator('#vex-text-editor')).toHaveValue('Task');
    await page.keyboard.press('Escape');
  });
});
