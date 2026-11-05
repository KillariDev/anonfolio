import { openAddressForm, openTokenSettings, mockVerification } from './helpers';
import { expect, test } from '@playwright/test';

const a = '0x0000000000000000000000000000000000000001';
const b = '0x0000000000000000000000000000000000000002';
test.beforeEach(async ({ page }, info) => { if (!info.title.includes('live mainnet') && !process.env.BASE_URL && !process.env.IPFS_GATEWAY_URL) await mockVerification(page); });

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
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Remove ' + a, exact: true }).click();
  await expect(page.locator('.wallet')).toHaveCount(1);
  await expect(page.locator('.wallet-head .wallet-address')).toHaveText(b);
  await page.reload();
  await expect(page.locator('.wallet')).toHaveCount(1);
  await expect(page.locator('.wallet-head .wallet-address')).toHaveText(b);
  page.once('dialog', dialog => dialog.accept());
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
  const liveAddress = process.env.LIVE_WALLET_ADDRESS || '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const publicBalanceCalls: string[] = [];
  page.on('request', req => {
    const body = req.postData() || '';
    if ((req.method() === 'POST' && body.includes('jsonrpc')) || /https:\/\/(ethereum-rpc\.publicnode\.com|eth\.drpc\.org|rpc\.ankr\.com|ethereum-beacon-api\.publicnode\.com)\//.test(req.url())) publicBalanceCalls.push(req.url());
  });
  await page.goto(process.env.IPFS_GATEWAY_URL || '/');
  if (process.env.LIVE_BALANCE_RPC) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Balance RPC endpoints', { exact: true }).fill(process.env.LIVE_BALANCE_RPC);
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Save settings and reconnect' }).click()]);
  }
  await openTokenSettings(page);
  await page.getByLabel('Token contract address', { exact: true }).fill('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  await page.getByLabel('Symbol', { exact: true }).fill('USDC');
  await page.getByLabel('Decimals', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Add token', exact: true }).click();
  await openAddressForm(page);
  await page.locator('#address').fill(liveAddress);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.amount').first()).not.toHaveText('—', { timeout: 210_000 });
  await expect(page.locator('.amount').nth(1)).not.toHaveText('—', { timeout: 180_000 });
  await expect(page.locator('.amount').nth(2)).not.toHaveText('—', { timeout: 180_000 });
  expect(publicBalanceCalls).toEqual([]);
  const refresh = page.getByRole('button', { name: 'Refresh ' + liveAddress, exact: true });
  await expect(refresh).toBeEnabled({ timeout: 180_000 });
  // Exercise manual recovery from an unavailable oracle without permitting a fallback.
  if ((await page.locator('.price-estimate').first().textContent()) === 'Unpriced') {
    await refresh.click();
    await expect(refresh).toBeEnabled({ timeout: 180_000 });
  }
  await expect(page.locator('.price-estimate').first()).toContainText('USDC', { timeout: 5000 });
  const proven = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).wallets[0].balances) as any[]);
  expect(proven).toHaveLength(3);
  await test.info().attach('verified-balances', { body: JSON.stringify(proven, null, 2), contentType: 'application/json' });
  expect(proven.every(balance => balance.verifiedBlock?.hash && balance.verifiedBlock.timestamp)).toBe(true);
  await expect(page.locator('.decimals-source')).toHaveCount(0);
  expect(new Set(proven.map(balance => balance.verifiedBlock.hash)).size).toBe(1);
  expect(proven[0].estimate.pool).toBe('0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640');
  expect(proven[0].estimate.blockHash).toBe(proven[0].verifiedBlock.hash);
  expect(proven[0].estimate.window).toBe(1800);
  expect(proven[1].estimate.numerator).toBe(proven[0].estimate.numerator);
  expect(proven[1].estimate.denominator).toBe(proven[0].estimate.denominator);
  await page.getByRole('button', { name: 'Refresh ' + liveAddress, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh ' + liveAddress, exact: true })).toBeEnabled({ timeout: 180_000 });
  await expect(page.locator('.error')).toHaveCount(0);
  await openAddressForm(page);
  await page.locator('#address').fill('0x57f138c846dd879810213d0d23c583a9961b7ba2');
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.wallet').nth(1).locator('.amount')).toHaveText(['0', '0', '0'], { timeout: 180_000 });
  expect(publicBalanceCalls).toEqual([]);
  await page.screenshot({ path: process.env.IPFS_GATEWAY_URL ? 'ipfs-artifacts/live-mainnet.png' : 'test-results/live-mainnet.png', fullPage: true });
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
  await expect(page.locator('.error')).toHaveText(['Unavailable · verification failed', 'Unavailable · verification failed']);
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
