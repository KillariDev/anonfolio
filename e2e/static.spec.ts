import { expect, test } from '@playwright/test';

test('static build loads and handles unavailable bootstrap without public balance requests', async ({ page }) => {
  test.skip(!process.env.BASE_URL, 'Run bun run test:static against the production build.');
  const publicBalanceCalls: string[] = [];
  page.on('request', request => {
    const body = request.postData() || '';
    if (body.includes('eth_getBalance') || body.includes('70a08231')) publicBalanceCalls.push(request.url());
  });
  // A deterministic production smoke check: the public bootstrap is unavailable.
  await page.route('https://**', route => route.abort('failed'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A little less public.' })).toBeVisible();
  await page.locator('#address').fill('invalid');
  await page.getByRole('button', { name: 'Add wallet' }).click();
  await expect(page.getByRole('alert')).toContainText('valid Ethereum address');
  await page.locator('#address').fill('0x0000000000000000000000000000000000000001');
  await page.getByRole('button', { name: 'Add wallet' }).click();
  await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.amount')).toHaveText(['—', '—']);
  await expect(page.locator('.error')).toHaveText(['Lookup failed · retry available', 'Lookup failed · retry available']);
  expect(publicBalanceCalls).toEqual([]);
});
