import { openAddressForm, openTokenSettings } from './helpers';
import { expect, test } from '@playwright/test';

const a = '0x0000000000000000000000000000000000000001';
const b = '0x0000000000000000000000000000000000000002';

test('browser watchlist, exact zero, refresh, stale state, recovery, persistence and route isolation', async ({ page }) => {
  test.skip(!!process.env.BASE_URL, 'Module boundary injection runs against the Vite dev server.');
  const publicRpc: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.postData()?.includes('"jsonrpc"')) publicRpc.push(request.url());
  });
  // Replace only the connection boundary in test, retaining real UI, viem, encoding and retries.
  await page.route('**/src/connection.ts*', route => route.fulfill({ contentType: 'text/javascript', body: `
    window.__calls = [];
    window.__fail = false;
    export class Connection {
      constructor(onState) { this.onState = onState; }
      async get() {
        this.onState('starting');
        await new Promise(r => setTimeout(r, 100));
        this.onState('ready');
        return { fetch: async (url, init) => {
          const body = JSON.parse(init.body);
          window.__calls.push({ url, body, key: init.anonOptions.isolationKey });
          if (window.__fail) throw new Error('simulated private RPC outage');
          return Response.json({ jsonrpc: '2.0', id: body.id,
            result: body.method === 'eth_getBalance' ? '0x0' : '0x' + '0'.repeat(64) });
        }};
      }
      close() {}
    }
  ` }));
  await page.goto('/');
  await openAddressForm(page);
  await page.locator('#address').fill('not-an-address');
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.getByRole('alert')).toContainText('valid Ethereum address');
  await expect(page.locator('.wallet')).toHaveCount(0);
  for (const address of [a, b]) {
    await openAddressForm(page);
    await page.locator('#address').fill(address);
    await page.getByRole('button', { name: 'add address to track' }).click();
  }
  await expect(page.locator('.wallet')).toHaveCount(2);
  await expect(page.locator('.amount')).toHaveText(['0', '0', '0', '0']);
  await expect(page.locator('.error')).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh ' + a, exact: true })).toBeEnabled();
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls).toHaveLength(6);
  const keys = [...new Set(calls.map((call: any) => call.key))];
  expect(keys).toHaveLength(2);
  expect(calls.every((call: any) => !Array.isArray(call.body))).toBe(true);
  const destinations = keys.map(key => [...new Set(calls.filter((call: any) => call.key === key).map((call: any) => call.url))]);
  expect(destinations[0]).not.toEqual(destinations[1]);
  await page.evaluate(() => { (window as any).__fail = true; });
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(page.locator('.error')).toHaveText(['Stale · refresh failed', 'Stale · refresh failed']);
  await expect(page.locator('.amount')).toHaveText(['0', '0', '0', '0']);
  await expect(page.locator('.wallet').nth(1).locator('.error')).toHaveCount(0);
  expect(publicRpc).toEqual([]);
  await page.evaluate(() => { (window as any).__fail = false; });
  await page.locator('.wallet').first().getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(page.locator('.error')).toHaveCount(0);
  expect(page.url()).not.toContain(a);
  await page.reload();
  await expect(page.locator('.wallet')).toHaveCount(2);
  await expect(page.locator('.amount')).toHaveText(['0', '0', '0', '0']);
  await openAddressForm(page);
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.getByRole('alert')).toContainText('already on your watchlist');
  await expect(page.locator('.wallet')).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove ' + a, exact: true }).click();
  await expect(page.locator('.wallet')).toHaveCount(1);
  await expect(page.locator('.wallet-head .wallet-address')).toHaveText(b);
  await page.reload();
  await expect(page.locator('.wallet')).toHaveCount(1);
  await expect(page.locator('.wallet-head .wallet-address')).toHaveText(b);
  await page.getByRole('button', { name: 'Remove ' + b, exact: true }).click();
  await expect(page.locator('.empty')).toContainText('Your watchlist starts here');
  await page.reload();
  await expect(page.locator('.wallet')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('live mainnet through the actual tor-js worker', async ({ page }) => {
  test.setTimeout(480_000);
  test.skip(!process.env.LIVE_RPC, 'Opt in with LIVE_RPC=1; requires working WebRTC/Tor gateway.');
  const publicBalanceCalls: string[] = [];
  page.on('request', req => {
    const body = req.postData() || '';
    if (req.method() === 'POST' && (body.includes('eth_getBalance') || body.includes('70a08231'))) publicBalanceCalls.push(req.url());
  });
  await page.goto('/');
  await openTokenSettings(page);
  await page.getByLabel('Token contract address', { exact: true }).fill('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  await page.getByLabel('Symbol', { exact: true }).fill('USDC');
  await page.getByLabel('Decimals', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Add token', exact: true }).click();
  await openAddressForm(page);
  await page.locator('#address').fill('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.amount').first()).not.toHaveText('—', { timeout: 210_000 });
  await expect(page.locator('.amount').nth(1)).not.toHaveText('—', { timeout: 20_000 });
  await expect(page.locator('.amount').nth(2)).not.toHaveText('—', { timeout: 20_000 });
  expect(publicBalanceCalls).toEqual([]);
  await page.getByRole('button', { name: 'Refresh 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', exact: true })).toBeEnabled({ timeout: 180_000 });
  await expect(page.locator('.error')).toHaveCount(0);
  await openAddressForm(page);
  await page.locator('#address').fill('0x57f138c846dd879810213d0d23c583a9961b7ba2');
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.wallet').nth(1).locator('.amount')).toHaveText(['0', '0', '0'], { timeout: 180_000 });
  expect(publicBalanceCalls).toEqual([]);
  await page.screenshot({ path: 'test-results/live-mainnet.png', fullPage: true });
});

test('failed private startup shows retry and never displays a false zero', async ({ page }) => {
  test.skip(!!process.env.BASE_URL, 'Module boundary injection runs against the Vite dev server.');
  const rpcRequests: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST') rpcRequests.push(request.url());
  });
  await page.route('**/src/connection.ts*', route => route.fulfill({
    contentType: 'text/javascript',
    body: `
      window.__recover = false;
      export class Connection {
        constructor(onState) { this.onState = onState; }
        async get() {
          this.onState('starting');
          await new Promise(r => setTimeout(r, 100));
          if (!window.__recover) {
            this.onState('failed');
            throw new Error('gateway unavailable');
          }
          this.onState('ready');
          return { fetch: async (_, init) => {
            const body = JSON.parse(init.body);
            return Response.json({ jsonrpc: '2.0', id: body.id,
              result: body.method === 'eth_getBalance' ? '0x0' : '0x' + '0'.repeat(64) });
          }};
        }
        close() {}
      }
    `,
  }));
  await page.goto('/');
  await openAddressForm(page);
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.error')).toHaveText(['Lookup failed · retry available', 'Lookup failed · retry available']);
  await expect(page.locator('.amount')).toHaveText(['—', '—']);
  await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible();
  expect(rpcRequests).toEqual([]);
  await page.evaluate(() => { (window as any).__recover = true; });
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.locator('#connection')).toContainText('Private worker ready');
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(page.locator('.amount')).toHaveText(['0', '0']);
  await expect(page.locator('.error')).toHaveCount(0);
});
