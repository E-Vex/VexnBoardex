// T-005 — pan and zoom e2e tests.
// BLACK BOX (enforced by eslint `no-restricted-imports` for e2e/**):
// nothing from src/ may be imported here; we only read the HUD, the canvas
// pixels and the computed cursor style.
import { expect, test, type Page } from '@playwright/test';

const VIEWPORT = { width: 1280, height: 720 };
// Camera starts centered on world (0,0): cam = { -640, -360, zoom 1 }.
const INITIAL_CAM = 'cam -640.0, -360.0';

async function load(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('hud-cam')).toHaveText(INITIAL_CAM);
}

/** Read the text content of a HUD line by its `data-testid`. */
async function hudText(page: Page, testid: string): Promise<string> {
  return (await page.getByTestId(testid).textContent()) ?? '';
}

test.describe('pan and zoom @ 1280×720', () => {
  test.use({ viewport: VIEWPORT });

  test('1. Space + left drag pans (cam -740.0, -410.0)', async ({ page }) => {
    await load(page);
    const canvas = page.locator('canvas');

    // Hold Space.
    await page.keyboard.down('Space');
    // Drag from (400, 300) → (500, 350) in steps.
    await canvas.hover({ position: { x: 400, y: 300 } });
    await page.mouse.down();
    await page.mouse.move(420, 310);
    await page.mouse.move(450, 330);
    await page.mouse.move(480, 340);
    await page.mouse.move(500, 350);
    await page.mouse.up();
    await page.keyboard.up('Space');

    await expect(page.getByTestId('hud-cam')).toHaveText('cam -740.0, -410.0');
  });

  test('2. Middle-button drag gives the same result', async ({ page }) => {
    await load(page);
    const canvas = page.locator('canvas');

    await canvas.hover({ position: { x: 400, y: 300 } });
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(420, 310);
    await page.mouse.move(450, 330);
    await page.mouse.move(480, 340);
    await page.mouse.move(500, 350);
    await page.mouse.up({ button: 'middle' });

    await expect(page.getByTestId('hud-cam')).toHaveText('cam -740.0, -410.0');
  });

  test('3. Left drag without Space leaves cam unchanged', async ({ page }) => {
    await load(page);
    const canvas = page.locator('canvas');

    await canvas.hover({ position: { x: 400, y: 300 } });
    await page.mouse.down();
    await page.mouse.move(500, 350);
    await page.mouse.up();

    await expect(page.getByTestId('hud-cam')).toHaveText(INITIAL_CAM);
  });

  test('4. Wheel pans (not ctrl): cam -640.0, -240.0 then -580.0, -240.0', async ({
    page,
  }) => {
    await load(page);
    const canvas = page.locator('canvas');

    // Mouse at (300, 200), wheel(0, 120) → panBy(-0, -120) → cam.y = -240
    await canvas.hover({ position: { x: 300, y: 200 } });
    await page.mouse.wheel(0, 120);
    await expect(page.getByTestId('hud-cam')).toHaveText('cam -640.0, -240.0');

    // wheel(60, 0) → panBy(-60, 0) → cam.x = -580
    await page.mouse.wheel(60, 0);
    await expect(page.getByTestId('hud-cam')).toHaveText('cam -580.0, -240.0');
  });

  test('5. Ctrl + wheel zooms at the cursor', async ({ page }) => {
    await load(page);
    const canvas = page.locator('canvas');

    // Mouse at (300, 200), hold Control, wheel(0, -100).
    await canvas.hover({ position: { x: 300, y: 200 } });
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');

    // zoom 122%, world unchanged (-340.0, -160.0), cam ≈ (-585.6, -323.7)
    await expect(page.getByTestId('hud-zoom')).toHaveText('zoom 122%');
    await expect(page.getByTestId('hud-world')).toHaveText(
      'world -340.0, -160.0',
    );
    const cam = await hudText(page, 'hud-cam');
    // cam -585.6, -323.7 within ±0.2
    expect(cam).toMatch(/^cam -585\.[4-8]\d*, -323\.[5-9]\d*$/);
  });

  test('6. Keyboard zoom: Equal → 125%, then Minus → 100%', async ({ page }) => {
    await load(page);

    await page.keyboard.press('Equal');
    await expect(page.getByTestId('hud-zoom')).toHaveText('zoom 125%');
    await expect(page.getByTestId('hud-cam')).toHaveText('cam -512.0, -288.0');

    await page.keyboard.press('Minus');
    await expect(page.getByTestId('hud-zoom')).toHaveText('zoom 100%');
    await expect(page.getByTestId('hud-cam')).toHaveText(INITIAL_CAM);
  });

  test('7. Limits: 20× Equal reaches 800%, then 40× Minus reaches 5%', async ({
    page,
  }) => {
    await load(page);

    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Equal');
    }
    await expect(page.getByTestId('hud-zoom')).toHaveText('zoom 800%');

    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Minus');
    }
    await expect(page.getByTestId('hud-zoom')).toHaveText('zoom 5%');
  });

  test('8. Reset: after Equal, Digit0 resets zoom with center fixed', async ({
    page,
  }) => {
    await load(page);

    await page.keyboard.press('Equal');
    await expect(page.getByTestId('hud-zoom')).toHaveText('zoom 125%');

    await page.keyboard.press('Digit0');
    await expect(page.getByTestId('hud-zoom')).toHaveText('zoom 100%');
    await expect(page.getByTestId('hud-cam')).toHaveText(INITIAL_CAM);
  });

  test('9. Cursor style: grab with Space, grabbing while dragging, neither after', async ({
    page,
  }) => {
    await load(page);
    const canvas = page.locator('canvas');

    // Hold Space → cursor is 'grab'.
    await page.keyboard.down('Space');
    await expect(canvas).toHaveCSS('cursor', 'grab');

    // Start dragging → cursor is 'grabbing'.
    await canvas.hover({ position: { x: 400, y: 300 } });
    await page.mouse.down();
    await expect(canvas).toHaveCSS('cursor', 'grabbing');

    // Release → cursor matches neither 'grab' nor 'grabbing' (Space still held
    // would be 'grab', so release Space first to get 'default').
    await page.mouse.up();
    await page.keyboard.up('Space');
    const cursor = await canvas.evaluate((el) => {
      return window.getComputedStyle(el as HTMLElement).cursor;
    });
    expect(cursor).not.toBe('grab');
    expect(cursor).not.toBe('grabbing');
  });

  test('10. Stuck Space: blur resets, then left-drag does nothing', async ({
    page,
  }) => {
    await load(page);
    const canvas = page.locator('canvas');

    // Hold Space, dispatch a blur on window.
    await page.keyboard.down('Space');
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
    });

    // Now left-drag should not pan (state is idle, spaceHeld false).
    await canvas.hover({ position: { x: 400, y: 300 } });
    await page.mouse.down();
    await page.mouse.move(500, 350);
    await page.mouse.up();

    await expect(page.getByTestId('hud-cam')).toHaveText(INITIAL_CAM);
    const cursor = await canvas.evaluate((el) => {
      return window.getComputedStyle(el as HTMLElement).cursor;
    });
    expect(cursor).not.toBe('grab');
  });

  test('11. Default prevented: plain wheel and Ctrl+wheel report true', async ({
    page,
  }) => {
    await load(page);
    const canvas = page.locator('canvas');

    // Inject a bubble-phase wheel listener on window that records defaultPrevented.
    await page.evaluate(() => {
      (window as unknown as { __wheelResults: unknown[] }).__wheelResults = [];
      window.addEventListener(
        'wheel',
        (e) => {
          (window as unknown as { __wheelResults: unknown[] }).__wheelResults.push(
            e.defaultPrevented,
          );
        },
        { passive: true },
      );
    });

    // Plain wheel.
    await canvas.hover({ position: { x: 300, y: 200 } });
    await page.mouse.wheel(0, 120);

    // Ctrl + wheel.
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');

    const results = await page.evaluate(() => {
      return (window as unknown as { __wheelResults: unknown[] }).__wheelResults;
    });
    expect(results).toEqual([true, true]);
  });

  test('12. Rendering follows the camera: canvas differs after a pan, identical after panning back', async ({
    page,
  }) => {
    await load(page);
    const canvas = page.locator('canvas');

    // Snapshot the original canvas image.
    const original = await canvas.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      return c.toDataURL();
    });

    // Pan by (100, 50) via Space + left drag.
    await page.keyboard.down('Space');
    await canvas.hover({ position: { x: 400, y: 300 } });
    await page.mouse.down();
    await page.mouse.move(500, 350);
    await page.mouse.up();
    await page.keyboard.up('Space');

    // The canvas should differ after panning.
    const afterPan = await canvas.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      return c.toDataURL();
    });
    expect(afterPan).not.toBe(original);

    // Pan back by the exact opposite amount: (-100, -50).
    await page.keyboard.down('Space');
    await canvas.hover({ position: { x: 500, y: 350 } });
    await page.mouse.down();
    await page.mouse.move(400, 300);
    await page.mouse.up();
    await page.keyboard.up('Space');

    // The canvas should be identical to the original.
    const afterPanBack = await canvas.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      return c.toDataURL();
    });
    expect(afterPanBack).toBe(original);
  });
});
