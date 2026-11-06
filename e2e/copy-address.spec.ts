import { expect, test } from '@playwright/test';
import { mockVerification } from './helpers';

const a = '0x0000000000000000000000000000000000000001';

test('copying an address writes it to the clipboard and briefly shows a Copied tooltip', async ({ page, context }) => {
  test.skip(!!process.env.BASE_URL || !!process.env.IPFS_GATEWAY_URL);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mockVerification(page);
  await page.route('**/src/connection.ts*', route => route.fulfill({ contentType: 'text/javascript', body: 'export class Connection {constructor(state){this.state=state;} get(){this.state("ready");return Promise.resolve({fetch:async()=>{throw Error("No network");}});}close(){}}' }));
  await page.goto('/');
  await page.locator('#address').fill('Savings | ' + a);
  await page.getByRole('button', { name: 'add address to track', exact: true }).click();
  await expect(page.locator('.wallet')).toHaveCount(1);
  await expect(page.locator('.wallet[data-loading="true"]')).toHaveCount(0);
  const copy = page.getByRole('button', { name: 'Copy ' + a + ' · Savings', exact: true });
  await copy.click();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText('Copied');
  await expect(copy).toHaveAttribute('aria-describedby', 'explanation-tooltip');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(a);
  // Moving away does not dismiss the confirmation early; it clears on its own.
  await page.mouse.move(0, 0);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toBeHidden({ timeout: 3000 });
  await expect(copy).not.toHaveAttribute('data-tooltip', /.+/);
  // Hovering the control afterwards shows nothing stale.
  await copy.hover();
  await expect(tooltip).toBeHidden();
});
