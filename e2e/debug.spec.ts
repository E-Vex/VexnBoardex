import { expect, test } from '@playwright/test';

const VIEWPORT = { width: 1280, height: 720 };

test.use({ viewport: VIEWPORT });

test('debug top-most drag', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('selectInput') || t.includes('dispatch')) logs.push(t);
  });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  await page.goto('/');
  await page.mouse.dblclick(300, 200);
  await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 1');
  await page.mouse.dblclick(460, 200);
  await expect(page.getByTestId('hud-nodes')).toHaveText('nodes 2');
  await expect(page.getByTestId('hud-rev')).toHaveText('rev 2');

  await page.mouse.move(380, 200);
  await page.mouse.down();
  await page.mouse.move(380, 300);
  await page.mouse.move(380, 400);
  await page.mouse.up();

  await page.waitForTimeout(500);
  const rev = await page.getByTestId('hud-rev').textContent();
  console.log('RESULT rev=', rev);
  console.log('LOGS:\n' + logs.join('\n'));
});
