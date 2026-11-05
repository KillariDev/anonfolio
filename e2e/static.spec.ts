import { openAddressForm, openTokenSettings } from './helpers';
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
  await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
  await openAddressForm(page);
  await page.locator('#address').fill('invalid');
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.getByRole('alert')).toContainText('valid Ethereum address');
  await openAddressForm(page);
  await page.locator('#address').fill('0x0000000000000000000000000000000000000001');
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.amount')).toHaveText(['—', '—']);
  await expect(page.locator('.error')).toHaveText(['Lookup failed · retry available', 'Lookup failed · retry available']);
  expect(publicBalanceCalls).toEqual([]);
});

test('static build reopens completely offline with saved wallets, token settings and balances', async ({ page, context }) => {
  test.skip(!process.env.BASE_URL, 'Offline shell is emitted only by the production build.');
  await page.setViewportSize({ width: 390, height: 844 });
  const a = '0x0000000000000000000000000000000000000001';
  const icon = 'data:image/png;base64,' + await (await import('node:fs/promises')).readFile(new URL('../src/assets/tokens/eth.png', import.meta.url), 'base64');
  const token = { icon, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 };
  const timestamp = Date.now() - 60_000;
  await page.route('https://**', route => route.abort('failed'));
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
    });
  });
  await page.evaluate(({ address, token, timestamp }) => {
    localStorage.setItem('anonfolio.portfolio.v2', JSON.stringify({
      version: 2, tokens: [token],
      wallets: [{ address, eth: { amount: '1000000000000000000', updatedAt: timestamp },
        weth: { amount: '0', updatedAt: timestamp },
        tokens: { [token.address]: { amount: '1234567', updatedAt: timestamp } } }],
    }));
  }, { address: a, token, timestamp });
  const cachedUrls = await page.evaluate(async () => {
    const keys = await caches.keys();
    const entries = await Promise.all(keys.filter(key => key.startsWith('anonfolio-shell-')).map(async key =>
      (await (await caches.open(key)).keys()).map(request => request.url)));
    return entries.flat();
  });
  expect(cachedUrls.length).toBeGreaterThan(0);
  expect(cachedUrls.every(url => url.startsWith(new URL(page.url()).origin + '/'))).toBe(true);
  expect(cachedUrls.some(url => url.includes('ethereum-rpc') || url.includes('tor-js'))).toBe(false);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.amount')).toHaveText(['1', '0', '1.23']);
  await expect(page.locator('.total-label img')).toHaveCount(3);
  await expect.poll(() => page.locator('.total-label img').evaluateAll(images =>
    images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await expect(page.locator('#offline-notice')).toContainText('offline');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.error')).toHaveText(['Stale · refresh failed', 'Stale · refresh failed', 'Stale · refresh failed']);
  await expect(page.locator('.wallet .spinner')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh ' + a, exact: true })).toBeEnabled();
  expect(await page.locator('.balance time').first().getAttribute('datetime')).toBe(new Date(timestamp).toISOString());
  await openTokenSettings(page);
  await expect(page.getByRole('button', { name: 'Remove token USDC' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove ' + a, exact: true }).click();
  await page.reload();
  await expect(page.locator('.wallet')).toHaveCount(0);
  await context.setOffline(false);
});
