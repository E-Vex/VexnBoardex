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
// padding 16); a card born in a column fills the INNER width (208 at the
// default 240 — T-037), so slot 1 sits 132 lower. Column affordances
// (T-037): the header strip is world y [column.y, column.y + 36] and the
// resize handles sit on the right-edge midpoint, bottom-edge midpoint and
// bottom-right corner of the effective rect.
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

  // ── T-037: column drag / rename / resize, auto-grow, drop-target highlight ──

  // The To Do header strip (clear of the × zone): world (-340, -182).
  const TODO_HEADER: [number, number] = [300, 178];
  // The To Do right-edge resize handle: world (-160, 0).
  const TODO_RIGHT_HANDLE: [number, number] = [480, 360];
  // The To Do bottom-edge resize handle (empty column): world (-280, 200).
  const TODO_BOTTOM_HANDLE: [number, number] = [360, 560];
  // To Do's card-centre press point (a 208-wide seated card): world (-280, -88).
  const TODO_CARD_CENTRE: [number, number] = [360, 272];

  test('9. dragging a column by its header moves it WITH its cards — one undo restores', async ({
    page,
  }) => {
    await page.goto('/');
    await createBoard(page);
    await createCardInTodo(page, [356, 250]); // rev 2 — one seated card

    // Press the To Do header and drag DOWN by 300 world units.
    await page.mouse.move(TODO_HEADER[0], TODO_HEADER[1]);
    await page.mouse.down();
    await page.mouse.move(TODO_HEADER[0], TODO_HEADER[1] + 300, { steps: 10 });

    // Mid-drag the PREVIEW is already painted at the destination: the
    // panel below the old bottom (world (-390, 250) → screen (250, 610))…
    await expectPainted(page, 250, 610);
    // …and the card travelled with it (world (-290, 212) → screen (350, 572),
    // the interior of the previewed card).
    await expectPainted(page, 350, 572);

    await page.mouse.up();
    // ONE batch: the column geometry AND the card moved together.
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    // A header press selects the members first (the frame-click behaviour).
    await expect(page.getByTestId('hud-selected')).toHaveText('selected 1');
    // The old header area is bare background again.
    await expectCleared(page, 250, 178);

    // ONE undo restores the column AND the card.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');
    await expectCleared(page, 250, 610);
    await expectCleared(page, 350, 572);
    await expectPainted(page, 250, 178);
  });

  test('10. double-clicking a header renames the column — one undo restores', async ({
    page,
  }) => {
    await page.goto('/');
    await createBoard(page);

    // Double-click the To Do header: the overlay opens ON THE NAME.
    await page.mouse.dblclick(TODO_HEADER[0], TODO_HEADER[1]);
    await expect(page.locator('#vex-text-editor')).toBeVisible();
    await expect(page.locator('#vex-text-editor')).toHaveValue('To Do');

    // A column name is one line: plain Enter commits (no newline, no card).
    await page.keyboard.type('Backlog');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 0');

    // Reopening shows the committed name; Escape cancels without a dispatch.
    await page.mouse.dblclick(TODO_HEADER[0], TODO_HEADER[1]);
    await expect(page.locator('#vex-text-editor')).toHaveValue('Backlog');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');

    // ONE undo restores the old name.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    await page.mouse.dblclick(TODO_HEADER[0], TODO_HEADER[1]);
    await expect(page.locator('#vex-text-editor')).toHaveValue('To Do');
    await page.keyboard.press('Escape');
  });

  test('11. resizing a column wider stretches its cards — one undo restores', async ({
    page,
  }) => {
    await page.goto('/');
    await createBoard(page);
    await createCardInTodo(page, [356, 250]); // rev 2 — one seated (208-wide) card

    // Drag the right-edge handle right by 80 world units: 240 → 320 wide.
    await page.mouse.move(TODO_RIGHT_HANDLE[0], TODO_RIGHT_HANDLE[1]);
    await page.mouse.down();
    await page.mouse.move(TODO_RIGHT_HANDLE[0] + 80, TODO_RIGHT_HANDLE[1], {
      steps: 10,
    });
    // Mid-drag the PREVIEW is wider already — the panel reaches into the gap
    // between To Do and Doing (world (-140, 150) → screen (500, 510))…
    await expectPainted(page, 500, 510);
    // …and the card is stretched to the inner width 288 (world (-140, -50) →
    // screen (500, 310), previously bare background right of the column).
    await expectPainted(page, 500, 310);

    await page.mouse.up();
    // ONE batch: the geometry AND the re-fitted card.
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    await expectPainted(page, 500, 510);
    await expectPainted(page, 500, 310);

    // ONE undo restores the width AND the card's size.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');
    await expectCleared(page, 500, 510);
    await expectCleared(page, 500, 310);
  });

  test('12. a column auto-grows to fit its cards; undo un-grows with them', async ({
    page,
  }) => {
    await page.goto('/');
    await createBoard(page);

    // Three cards stack to content height 452 > the stored 400. Each
    // double-click lands in the empty padding strip between the header and
    // the stack's top (world y -155), so every click is empty space and
    // each new card is born ABOVE the previous one.
    await createCardInTodo(page, [356, 205]); // rev 2
    await createCardInTodo(page, [356, 205]); // rev 3
    await createCardInTodo(page, [356, 205]); // rev 4
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 3');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');

    // The panel reaches below the old bottom (world (-390, 230) → (250, 590)):
    // grown to the cards, without clipping them.
    await expectPainted(page, 250, 590);

    // ONE undo removes the third card AND the growth with it.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 5');
    await expectCleared(page, 250, 590);
  });

  test('13. dragging the bottom-edge handle makes the column taller', async ({
    page,
  }) => {
    await page.goto('/');
    await createBoard(page);
    await createCardInTodo(page, [356, 250]); // rev 2

    // Drag the bottom-edge handle down 60 world units: stored 400 → 460.
    await page.mouse.move(TODO_BOTTOM_HANDLE[0], TODO_BOTTOM_HANDLE[1]);
    await page.mouse.down();
    await page.mouse.move(TODO_BOTTOM_HANDLE[0], TODO_BOTTOM_HANDLE[1] + 60, {
      steps: 10,
    });
    // Mid-drag the taller PREVIEW is painted below the old bottom.
    await expectPainted(page, 250, 590);

    await page.mouse.up();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    await expectPainted(page, 250, 590); // the column is now 460 tall

    // ONE undo restores the stored height.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');
    await expectCleared(page, 250, 590);
  });

  test('14. a card drag highlights the column under it — and only that one', async ({
    page,
  }) => {
    await page.goto('/');
    await createBoard(page);
    await createCardInTodo(page, [356, 250], 'Task'); // rev 3 (batch + text)

    const panel = await panelColor(page);

    // Drag the card over Doing's body (world (40, 40)).
    await page.mouse.move(TODO_CARD_CENTRE[0], TODO_CARD_CENTRE[1]);
    await page.mouse.down();
    await page.mouse.move(680, 400, { steps: 10 });

    // Mid-drag: Doing's panel is highlighted — a different wash than the
    // plain panel colour (probe world (-90, 150) → screen (550, 510), clear
    // of the dragged card, which previews glued to Doing's slot 0 above it).
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 550, 510), panel))
      .toBe(false);

    // Leaving every column clears the highlight again.
    await page.mouse.move(200, 400, { steps: 10 }); // world (-440, 40)
    await expect
      .poll(async () => sameColor(await canvasPixel(page, 550, 510), panel))
      .toBe(true);

    // Release outside: the card is freed, one batch (T-035 semantics).
    await page.mouse.up();
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
  });

  // ── T-039: collapsible columns ──────────────────────────────────────────

  // The To Do header's ‹ chevron (world (-374, -182)), left of the name.
  const TODO_CHEVRON: [number, number] = [266, 178];
  // The › chevron of To Do's COLLAPSED rail (world (-382, -182)).
  const TODO_RAIL_CHEVRON: [number, number] = [258, 178];
  // The rail's interior, below the chevron strip and clear of the rotated
  // name (world (-382, 20)).
  const TODO_RAIL: [number, number] = [258, 380];
  // The middle of the rail (world (-382, -60)) — a dblclick target.
  const TODO_RAIL_CENTRE: [number, number] = [258, 300];
  // To Do's former panel body, right of the rail and below the seated card
  // (world (-240, 150)).
  const TODO_BODY: [number, number] = [400, 510];

  test('15. clicking the header chevron collapses the column to a rail — one undo restores', async ({
    page,
  }) => {
    await page.goto('/');
    await createBoard(page);
    await createCardInTodo(page, [356, 250]); // rev 2 — one seated card

    // Click the ‹ chevron: ONE group.update → rev 3.
    await page.mouse.click(TODO_CHEVRON[0], TODO_CHEVRON[1]);
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');

    // The rail is painted at the column's left edge…
    await expectPainted(page, TODO_RAIL[0], TODO_RAIL[1]);
    // …the panel body is bare background again…
    await expectCleared(page, TODO_BODY[0], TODO_BODY[1]);
    // …and the seated card is hidden (not deleted).
    await expectCleared(page, TODO_SLOT0[0], TODO_SLOT0[1]);
    // The Doing column is untouched by the collapse.
    await expectPainted(page, DOING_PANEL[0], DOING_PANEL[1]);

    // The × is gone with the panel: a click where it used to live hits
    // empty space (a marquee), not a delete — the revision stands.
    await page.mouse.click(TODO_CLOSE[0], TODO_CLOSE[1]);
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 3');
    await expectPainted(page, TODO_RAIL[0], TODO_RAIL[1]);

    // ONE undo expands the column: the card returns to its exact slot.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');
    await expectCard(page, TODO_SLOT0[0], TODO_SLOT0[1]);
    await expectPainted(page, TODO_BODY[0], TODO_BODY[1]);
  });

  test('16. clicking the rail’s chevron expands the column again; the cards return', async ({
    page,
  }) => {
    await page.goto('/');
    await createBoard(page);
    await createCardInTodo(page, [356, 250]); // rev 2
    await page.mouse.click(TODO_CHEVRON[0], TODO_CHEVRON[1]); // rev 3 — collapsed

    // The rail's › chevron expands (ONE group.update → rev 4).
    await page.mouse.click(TODO_RAIL_CHEVRON[0], TODO_RAIL_CHEVRON[1]);
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');
    // The panel and the seated card are back exactly where they were.
    await expectPainted(page, TODO_BODY[0], TODO_BODY[1]);
    await expectCard(page, TODO_SLOT0[0], TODO_SLOT0[1]);
    // The rail-only strip is panel again (the column grew back).
    await expectPainted(page, TODO_RAIL[0], TODO_RAIL[1]);
  });

  test('17. a double-click on the rail expands the column too', async ({
    page,
  }) => {
    await page.goto('/');
    await createBoard(page);
    await createCardInTodo(page, [356, 250]); // rev 2
    await page.mouse.click(TODO_CHEVRON[0], TODO_CHEVRON[1]); // rev 3 — collapsed

    // Double-click the middle of the rail: the two single clicks arm and
    // disarm a move gesture (no command, D-26); the dblclick expands — ONE
    // group.update → rev 4, not 5.
    await page.mouse.dblclick(TODO_RAIL_CENTRE[0], TODO_RAIL_CENTRE[1]);
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');
    await expectCard(page, TODO_SLOT0[0], TODO_SLOT0[1]);
    await expectPainted(page, TODO_BODY[0], TODO_BODY[1]);
  });

  test('18. dragging a collapsed rail moves the column — the cards follow it', async ({
    page,
  }) => {
    await page.goto('/');
    await createBoard(page);
    await createCardInTodo(page, [356, 250]); // rev 2
    await page.mouse.click(TODO_CHEVRON[0], TODO_CHEVRON[1]); // rev 3 — collapsed

    // Drag the rail DOWN by 200 world units.
    await page.mouse.move(TODO_RAIL_CENTRE[0], TODO_RAIL_CENTRE[1]);
    await page.mouse.down();
    await page.mouse.move(TODO_RAIL_CENTRE[0], TODO_RAIL_CENTRE[1] + 200, {
      steps: 10,
    });
    // Mid-drag the PREVIEW is already at the destination…
    await expectPainted(page, TODO_RAIL_CENTRE[0], TODO_RAIL_CENTRE[1] + 200);
    // …and the rail's old spot is bare background.
    await expectCleared(page, TODO_RAIL_CENTRE[0], TODO_RAIL_CENTRE[1]);

    await page.mouse.up();
    // ONE batch: the stored geometry AND the hidden card moved together.
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 4');

    // Expand at the rail's NEW position (world (-382, 18) → screen (258, 378)):
    // the › chevron sits at the top of the moved rail.
    await page.mouse.click(TODO_RAIL_CHEVRON[0], TODO_RAIL_CHEVRON[1] + 200);
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 5');
    // The card followed: world (-240, 110) → screen (400, 470) — the moved
    // column's body, where the seated card now paints.
    await expectCard(page, 400, 470);
  });

  test('19. a reload keeps the collapsed state — and the cards behind it (autosave)', async ({
    page,
  }) => {
    await page.goto('/');
    await createBoard(page);
    await createCardInTodo(page, [356, 250]); // rev 2
    await page.mouse.click(TODO_CHEVRON[0], TODO_CHEVRON[1]); // rev 3 — collapsed

    // Wait out the 1s autosave debounce, then reload.
    await page.waitForTimeout(1600);
    await page.reload();

    await expect(page.getByTestId('hud-rev')).toHaveText('rev 1');
    await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
    // Still a rail: painted at the edge, the body bare, the card hidden.
    await expectPainted(page, TODO_RAIL[0], TODO_RAIL[1]);
    await expectCleared(page, TODO_BODY[0], TODO_BODY[1]);
    await expectCleared(page, TODO_SLOT0[0], TODO_SLOT0[1]);

    // Expanding after the reload reveals the card IN ITS SLOT — the
    // membership survived the round trip.
    await page.mouse.click(TODO_RAIL_CHEVRON[0], TODO_RAIL_CHEVRON[1]);
    await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');
    await expectCard(page, TODO_SLOT0[0], TODO_SLOT0[1]);
  });
});
