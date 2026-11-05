import { expect, test } from '@playwright/test';
import { openAddressForm, openTokenSettings } from './helpers';

for (const mode of ['path', 'subdomain']) {
  test('IPFS gateway ' + mode + ' serves assets, settings, named wallets and an offline reload', async ({ page, context }) => {
    test.skip(!process.env.IPFS_GATEWAY_URL, 'Run bun run test:ipfs with Kubo installed.');
    const url = mode === 'path' ? process.env.IPFS_GATEWAY_URL! : process.env.IPFS_SUBDOMAIN_URL!;
    const publicBalanceRequests: string[] = [];
    const assetRequests: string[] = [];
    page.on('request', request => {
      const body = request.postData() || '';
      if (request.method() === 'POST' && (body.includes('eth_getBalance') || body.includes('70a08231'))) publicBalanceRequests.push(request.url());
      if (request.resourceType() === 'script' || request.resourceType() === 'stylesheet') assetRequests.push(request.url());
    });
    await page.route('https://**', route => route.abort('failed'));
    await page.goto(url);
    await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
    await expect(page.locator('.total-label img')).toHaveCount(2);
    await expect.poll(() => page.locator('.total-label img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    expect(assetRequests.length).toBeGreaterThan(1);
    expect(assetRequests.every(asset => asset.startsWith(url))).toBe(true);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
    });
    const worker = await page.evaluate(() => navigator.serviceWorker.getRegistration().then(registration => ({ scope: registration?.scope, script: registration?.active?.scriptURL })));
    expect(worker).toEqual({ scope: url, script: url + 'sw.js' });
    await openTokenSettings(page);
    await page.getByLabel('Token contract address', { exact: true }).fill('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    await page.getByLabel('Symbol', { exact: true }).fill('USDC');
    await page.getByLabel('Decimals', { exact: true }).fill('6');
    await page.getByRole('button', { name: 'Add token', exact: true }).click();
    await openAddressForm(page);
    const address = '0x0000000000000000000000000000000000000001';
    await page.getByLabel('Address name', { exact: false }).fill('IPFS savings');
    await page.locator('#address').fill(address);
    await page.getByRole('button', { name: 'add address to track' }).click();
    await expect(page.locator('.wallet-head .address-name')).toHaveText('IPFS savings');
    await context.setOffline(true);
    await expect(page.locator('.wallet[data-loading="true"]')).toHaveCount(0);
    // Preserve a successful zero distinctly from an unread balance, as on HTTPS.
    await page.evaluate(() => {
      const key = 'anonfolio.portfolio.v2';
      const saved = JSON.parse(localStorage.getItem(key)!);
      saved.wallets[0].balances.eth = { amount: '0', updatedAt: Date.now() - 60_000 };
      localStorage.setItem(key, JSON.stringify(saved));
    });
    await page.reload();
    await expect(page.locator('.wallet-head .address-name')).toHaveText('IPFS savings');
    await expect(page.locator('.wallet-head svg rect')).toHaveCount(64);
    await expect(page.locator('.amount')).toHaveText(['0', '—', '—']);
    await expect(page.locator('.balance small.error').first()).toHaveText('Stale · refresh failed');
    await expect(page.locator('#offline-notice')).toContainText('offline');
    await openTokenSettings(page);
    await expect(page.getByRole('button', { name: 'Remove token USDC', exact: true })).toBeVisible();
    await expect(page.getByLabel('Tor gateways', { exact: true })).not.toHaveValue('');
    expect(publicBalanceRequests).toEqual([]);
    expect(page.url()).toBe(url);
    await page.screenshot({ path: 'ipfs-artifacts/ipfs-' + mode + '.png', fullPage: true });
    await context.setOffline(false);
  });
}
