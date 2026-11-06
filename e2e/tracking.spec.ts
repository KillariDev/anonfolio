import { encodeAbiParameters, keccak256, stringToBytes } from 'viem';
import { openWalletDetails, openAddressForm, openTokenSettings, mockVerification } from './helpers';
import { expect, test, type Page } from '@playwright/test';

const a = '0x0000000000000000000000000000000000000001';
const b = '0x0000000000000000000000000000000000000002';
const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

async function mockConnection(page: Page, paused = false, failure = false) {
  await page.route('**/src/connection.ts*', route => route.fulfill({ contentType: 'text/javascript', body: `
    window.__calls = [];
    window.__fail = ${failure};
    window.__delay = 150;
    export class Connection {
      constructor(onState, onProgress) { this.onState = onState; this.onProgress = onProgress; }
      get() {
        if (this.pending) return this.pending;
        this.onState('starting');
        this.onProgress?.('Loading bundled Tor worker; checking its pinned hash locally.');
        return this.pending = (async () => {
          ${paused ? 'await new Promise(resolve => { window.__releaseConnection = resolve; });' : ''}
          this.onState('ready');
          return { fetch: async (url, init) => {
            const body = JSON.parse(init.body);
            window.__calls.push({ url, body, key: init.anonOptions.isolationKey });
            await new Promise(resolve => setTimeout(resolve, window.__delay));
            if (window.__fail) throw new Error('private connection unavailable');
            const custom = body.method === 'eth_call' && body.params[0].to.toLowerCase() === '${usdc.toLowerCase()}';
            return Response.json({ jsonrpc: '2.0', id: body.id,
              result: body.method === 'eth_getBalance' ? (window.__ethBalance || '0xde0b6b3a7640000') : '0x' + (custom ? 1234567n : 0n).toString(16).padStart(64, '0') });
          }};
        })();
      }
      close() {}
    }
  ` }));
}
async function addToken(page: Page) {
  await openTokenSettings(page);
  await page.getByLabel('Token contract address', { exact: true }).fill(usdc);
  await page.getByLabel('Symbol', { exact: true }).fill('USDC');
  await page.getByLabel('Decimals', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Add token', exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await mockVerification(page);
  test.skip(!!process.env.BASE_URL, 'Connection injection is only used with the development server.');
});

test('bulk additions show spinners and the current stage, then private per-token requests', async ({ page }) => {
  const publicPosts: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') publicPosts.push(request.url()); });
  await mockConnection(page, true);
  await page.goto('/');
  await expect(page.locator('#connection .spinner')).toBeVisible();
  await expect(page.locator('#connection strong')).toHaveText('Starting private connection…');
  await addToken(page);
  await openAddressForm(page);
  await page.locator('#address').fill(a + ',\n' + b + '\n' + a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.wallet')).toHaveCount(2);
  await expect(page.locator('.wallet[data-loading="true"]')).toHaveCount(2);
  await expect(page.locator('.activity-item.waiting')).toHaveCount(6);
  await expect(page.locator('.activity-item.waiting strong')).toHaveText(['ETH · Pending', 'WETH · Pending', 'USDC · Pending', 'ETH · Pending', 'WETH · Pending', 'USDC · Pending']);
  expect(await page.evaluate(() => (window as any).__calls.length)).toBe(0);
  await page.evaluate(() => { (window as any).__delay = 1000; (window as any).__releaseConnection(); });
  await expect(page.locator('.activity-item.requesting')).toHaveCount(6);
  await expect(page.locator('.activity').first()).toContainText('eth_getProof(address)');
  await expect(page.locator('.activity').first()).toContainText(usdc);
  await expect(page.locator('.activity').first()).not.toContainText('eth.drpc.org');
  await expect(page.locator('.amount')).toHaveText(['1', '1.23', '1', '1.23']);
  await expect(page.locator('.wallet[data-loading="true"]')).toHaveCount(0);
  await expect(page.locator('.wallet .spinner')).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls).toHaveLength(6);
  expect(new Set(calls.map((call: any) => call.key)).size).toBe(2);
  expect(new Set(calls.map((call: any) => call.url)).size).toBe(2);
  expect(publicPosts).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/tracking-mobile.png', fullPage: true });
});

test('cached token amounts and timestamps survive reload and failed refresh; removal is saved', async ({ page }) => {
  await mockConnection(page);
  await page.goto('/');
  await addToken(page);
  await openAddressForm(page);
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.amount')).toHaveText(['1', '1.23']);
  const originalTimes = await page.evaluate(() => Object.entries(JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).wallets[0].balances).map(([asset,value]:[string,any]) => [asset,value.updatedAt]).sort());
  const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!));
  expect(snapshot.tokens.find((token: any) => token.address === usdc).decimals).toBe(6);
  expect(snapshot.wallets[0].balances.eth.amount).toBe('1000000000000000000');
  expect(JSON.stringify(snapshot)).not.toContain('isolationKey');
  await page.evaluate(() => { (window as any).__fail = true; });
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(page.locator('.error')).toHaveCount(3);
  await expect(page.locator('.amount')).toHaveText(['1', '0', '1.23']);
  expect(await page.evaluate(() => Object.entries(JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).wallets[0].balances).map(([asset,value]:[string,any]) => [asset,value.updatedAt]).sort())).toEqual(originalTimes);
  await page.unroute('**/src/connection.ts*');
  await mockConnection(page, false, true);
  await page.reload();
  await expect(page.locator('.amount')).toHaveText(['1', '0', '1.23']);
  await expect(page.locator('.error')).toHaveCount(3);
  expect(await page.evaluate(() => Object.entries(JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).wallets[0].balances).map(([asset,value]:[string,any]) => [asset,value.updatedAt]).sort())).toEqual(originalTimes);
  await openTokenSettings(page);
  await page.getByRole('button', { name: 'Remove token USDC' }).click();
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
  await page.reload();
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
});

test('invalid bulk input is atomic and invalid or duplicate tokens do not change settings', async ({ page }) => {
  await mockConnection(page);
  await page.goto('/');
  await openAddressForm(page);
  await page.locator('#address').fill(a + '\ninvalid');
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('#input-error')).toContainText('valid Ethereum address');
  await expect(page.locator('.wallet')).toHaveCount(0);
  await addToken(page);
  await page.getByLabel('Token contract address', { exact: true }).fill(usdc);
  await page.getByLabel('Symbol', { exact: true }).fill('USDC');
  await page.getByLabel('Decimals', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Add token', exact: true }).click();
  await expect(page.locator('#token-error')).toContainText('already tracked');
  await expect(page.locator('#token-list li')).toHaveCount(3);
  await page.getByLabel('Token contract address', { exact: true }).fill(b);
  await page.getByLabel('Decimals', { exact: true }).fill('-1');
  await page.getByRole('button', { name: 'Add token', exact: true }).click();
  await expect(page.locator('#token-error')).toContainText('decimals');
  await expect(page.locator('#token-list li')).toHaveCount(3);
});

test('storage write failure is visible while reads and changes still work', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Quota full', 'QuotaExceededError'); };
  });
  await mockConnection(page);
  await page.goto('/');
  await openAddressForm(page);
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.amount')).toHaveText(['1']);
  await expect(page.locator('#storage-warning')).toContainText('could not be saved');
});

test('failed retrieval retries automatically without a button click and stops after success', async ({ page }) => {
  await mockConnection(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'add address to track' })).toBeVisible();
  await expect(page.getByText('YOUR WALLETS. YOUR BUSINESS.', { exact: true })).toHaveCount(0);
  await expect(page.locator('.privacy-note')).toHaveCount(0);
  await openAddressForm(page);
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.amount')).toHaveText(['1']);
  const originalCalls = await page.evaluate(() => (window as any).__calls);
  await page.evaluate(() => { (window as any).__fail = true; });
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(page.locator('.error')).toHaveCount(2);
  await expect(page.locator('.activity')).toContainText('Automatic retry 1 scheduled');
  await page.evaluate(() => { (window as any).__fail = false; });
  await expect(page.locator('.error')).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator('.amount')).toHaveText(['1']);
  await expect(page.locator('.activity')).not.toContainText('Automatic retry');
  const after = await page.evaluate(() => (window as any).__calls);
  expect(new Set(after.map((call: any) => call.key))).toEqual(new Set(originalCalls.map((call: any) => call.key)));
  const count = after.length;
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() => (window as any).__calls.length)).toBe(count);
});

test('offline reads resume automatically on reconnect and removed addresses never retry', async ({ page, context }) => {
  await mockConnection(page);
  await page.goto('/');
  await openAddressForm(page);
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.amount')).toHaveText(['1']);
  const initial = await page.evaluate(() => (window as any).__calls.length);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(page.locator('.activity')).toContainText('paused until the connection returns');
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() => (window as any).__calls.length)).toBe(initial);
  await context.setOffline(false);
  await expect(page.locator('.error')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__calls.length)).toBeGreaterThan(initial);
  await page.evaluate(() => { (window as any).__fail = true; });
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(page.locator('.activity')).toContainText('Automatic retry 1 scheduled');
  page.once('dialog', dialog => dialog.accept());
  await openWalletDetails(page, a);
  await page.getByRole('button', { name: 'Remove ' + a, exact: true }).click();
  const removedCount = await page.evaluate(() => (window as any).__calls.length);
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() => (window as any).__calls.length)).toBe(removedCount);
  await expect(page.locator('.wallet')).toHaveCount(0);
});

test('worker startup failures reconnect automatically and resume pending reads', async ({ page }) => {
  await page.route('**/src/connection.ts*', route => route.fulfill({
    contentType: 'text/javascript', body: `
      window.__recover = false;
      export class Connection {
        constructor(onState) { this.onState = onState; }
        async get() {
          if (!window.__recover) { this.onState('failed'); throw new Error('temporary startup failure'); }
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
  await expect(page.locator('.error')).toHaveCount(2);
  await expect(page.locator('#connection strong')).toHaveAttribute('title', /Automatic retry/);
  await page.evaluate(() => { (window as any).__recover = true; });
  await expect(page.locator('#connection')).toContainText('Private worker ready', { timeout: 8000 });
  await expect(page.locator('.amount')).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator('.error')).toHaveCount(0);
});

test('ten addresses fit compact rows with live totals and expandable details', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockConnection(page);
  await page.goto('/');
  await addToken(page);
  const addresses = Array.from({ length: 10 }, (_, i) => '0x' + (i + 1).toString(16).padStart(40, '0'));
  await openAddressForm(page);
  await page.locator('#address').fill(addresses.join('\n'));
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.wallet')).toHaveCount(10);
  await expect(page.locator('.total-amount')).toHaveText(['10', '0', '12.35']);
  await expect(page.locator('.total-status')).toHaveCount(0);
  for (const amount of await page.locator('.total-amount').all()) await expect(amount).toHaveAttribute('title', /10\/10 addresses/);
  await expect(page.locator('.wallet-details:visible')).toHaveCount(0);
  await expect(page.locator('#address')).not.toBeVisible();
  const table = await page.locator('.wallet-table').boundingBox();
  expect(table!.height).toBeLessThan(600);
  expect(table!.y + table!.height).toBeLessThan(1000);
  await page.getByRole('button', { name: 'Details ' + a, exact: true }).click();
  await expect(page.locator('.wallet').first().locator('.full-address')).toHaveCount(0);
  await expect(page.locator('.wallet').first().locator('.activity')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh ' + a, exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Details ' + a, exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Details ' + a, exact: true }).click();
  await page.screenshot({ path: 'test-results/compact-desktop.png', fullPage: true });
  page.once('dialog', dialog => dialog.accept());
  await openWalletDetails(page, a);
  await page.getByRole('button', { name: 'Remove ' + a, exact: true }).click();
  await expect(page.locator('.total-amount')).toHaveText(['9', '0', '11.11']);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#wallets')).toBeVisible();
  expect(await page.locator('#wallets').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Refresh ' + b, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh ' + b, exact: true })).toBeEnabled();
  await page.screenshot({ path: 'test-results/compact-mobile.png', fullPage: true });
});

test('overview flags partial and stale totals while preserving known values during failure', async ({ page }) => {
  await mockConnection(page, true);
  await page.goto('/');
  await openAddressForm(page);
  await page.locator('#address').fill(a + '\n' + b);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.total-amount')).toHaveText(['—', '—']);
  await expect(page.locator('.total-status')).toHaveCount(0);
  await expect(page.locator('.total-amount').first()).toHaveAttribute('title', /Partial · 0\/2 addresses/);
  await page.evaluate(() => { (window as any).__releaseConnection(); });
  await expect(page.locator('.total-amount')).toHaveText(['2', '0']);
  await page.evaluate(() => { (window as any).__fail = true; });
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  for (const amount of await page.locator('.total-amount').all()) await expect(amount).toHaveAttribute('title', /2\/2 addresses · 1 stale/);
  await expect(page.locator('.total-amount')).toHaveText(['2', '0']);
  await page.evaluate(() => { (window as any).__fail = false; });
  for (const amount of await page.locator('.total-amount').all()) await expect(amount).toHaveAttribute('title', / · 2\/2 addresses$/, { timeout: 8000 });
});

test('default tokens have icons and can be removed and re-added like other tokens', async ({ page }) => {
  await mockConnection(page);
  await page.goto('/');
  await expect(page.locator('.total-label .token-icon img')).toHaveCount(2);
  await expect.poll(() => page.locator('.total-label img').evaluateAll(images =>
    images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await openAddressForm(page);
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.amount')).toHaveText(['1']);
  await openTokenSettings(page);
  await page.getByRole('button', { name: 'Remove token ETH', exact: true }).click();
  await expect(page.locator('.total-label')).toHaveText(['WETH']);
  await page.reload();
  await expect(page.locator('.amount')).toHaveText(['0']);
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls).toEqual([]);
  await openTokenSettings(page);
  await page.getByRole('button', { name: 'Remove token WETH', exact: true }).click();
  await expect(page.locator('.amount')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.total')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__calls.length)).toBe(0);
  await openTokenSettings(page);
  for (const preset of ['eth', 'weth']) {
    await page.locator('#token-preset').selectOption(preset);
    await page.getByRole('button', { name: 'Add token', exact: true }).click();
  }
  await expect(page.locator('.amount')).toHaveText(['1']);
  await expect(page.locator('.total-label')).toHaveText(['ETH', 'WETH']);
  await page.reload();
  await expect(page.locator('.total-label')).toHaveText(['ETH', 'WETH']);
});

test('uploaded token icons are saved locally, can be changed on defaults, and make no remote image requests', async ({ page }) => {
  const remoteImages: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'image' && /^https?:/.test(request.url())
      && !request.url().startsWith('http://127.0.0.1:5173') && !request.url().startsWith('http://localhost:5173')) remoteImages.push(request.url());
  });
  await mockConnection(page);
  await page.goto('/');
  await openTokenSettings(page);
  await page.getByLabel('Token contract address', { exact: true }).fill(usdc);
  await page.getByLabel('Symbol', { exact: true }).fill('USDC');
  await page.getByLabel('Decimals', { exact: true }).fill('6');
  const icon = { name: 'icon.png', mimeType: 'image/png',
    buffer: Buffer.from(await (await import('node:fs/promises')).readFile(new URL('../src/assets/tokens/eth.png', import.meta.url))) };
  await page.locator('#token-icon').setInputFiles(icon);
  await page.getByRole('button', { name: 'Add token', exact: true }).click();
  const custom = page.locator('.total').filter({ has: page.locator('.total-label', { hasText: 'USDC' }) });
  await expect(custom.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!));
  expect(snapshot.version).toBe(3);
  expect(snapshot.tokens[2].icon).toMatch(/^data:image\/png;base64,/);
  await page.getByLabel('Change icon ETH', { exact: true }).setInputFiles(icon);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).tokens[0].icon)).toMatch(/^data:image\/png;base64,/);
  await page.reload();
  await expect(page.locator('.total-label img')).toHaveCount(3);
  await expect.poll(() => page.locator('.total-label img').evaluateAll(images =>
    images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  expect(remoteImages).toEqual([]);
});

test('invalid icon files leave the tracked list unchanged', async ({ page }) => {
  await mockConnection(page);
  await page.goto('/');
  await openTokenSettings(page);
  await page.getByLabel('Token contract address', { exact: true }).fill(usdc);
  await page.getByLabel('Symbol', { exact: true }).fill('USDC');
  await page.getByLabel('Decimals', { exact: true }).fill('6');
  await page.locator('#token-icon').setInputFiles({ name: 'icon.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await page.getByRole('button', { name: 'Add token', exact: true }).click();
  await expect(page.locator('#token-error')).toContainText('PNG, JPEG or WebP');
  await expect(page.locator('#token-list li')).toHaveCount(2);
});

test('network settings validate, reconnect with new private RPCs, preserve cached balances and restore defaults', async ({ page }) => {
  await mockConnection(page);
  await page.goto('/');
  await page.locator('#address').fill(a + '\n' + b);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.amount')).toHaveText(['1', '1']);
  await expect(page.locator('.wallet[data-loading="true"]')).toHaveCount(0);
  await page.locator('#network-settings > summary').click();
  const originalGateway = await page.getByLabel('Tor gateways', { exact: true }).inputValue();
  const originalRpcs = await page.getByLabel('Balance RPC endpoints').inputValue();
  await page.getByLabel('Balance RPC endpoints').fill('http://unsafe.example');
  await page.getByRole('button', { name: 'Save settings and reconnect' }).click();
  await expect(page.locator('#settings-error')).toContainText('HTTPS');
  expect(await page.evaluate(() => localStorage.getItem('anonfolio.network.v1'))).toBeNull();
  await page.getByLabel('Balance RPC endpoints').fill('https://one.example/rpc\nhttps://two.example/rpc');
  const customGateway = originalGateway.replace(':12298:', ':12299:');
  await page.getByLabel('Tor gateways', { exact: true }).fill(customGateway);
  // Pause the replacement worker to observe saved amounts during reconnect.
  await page.unroute('**/src/connection.ts*');
  await mockConnection(page, true);
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Save settings and reconnect' }).click()]);
  await expect(page.locator('.amount')).toHaveText(['1', '0', '1', '0']);
  await expect(page.locator('.balance small.cached')).toHaveCount(4);
  await expect(page.locator('#connection')).not.toContainText('152.236.3.22');
  expect(await page.evaluate(() => (window as any).__calls)).toEqual([]);
  await page.locator('#network-settings > summary').click();
  await expect(page.getByLabel('Tor gateways', { exact: true })).toHaveValue(customGateway);
  await page.evaluate(() => (window as any).__releaseConnection());
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  for (const address of [a, b]) await page.getByRole('button', { name: 'Refresh ' + address, exact: true }).click();
  await expect(page.locator('.wallet[data-loading="true"]')).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls).toHaveLength(4);
  expect(new Set(calls.map((call: any) => call.url))).toEqual(new Set(['https://one.example/rpc', 'https://two.example/rpc']));
  expect(new Set(calls.map((call: any) => call.key)).size).toBe(2);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Restore defaults' }).click()]);
  await page.locator('#network-settings > summary').click();
  await expect(page.getByLabel('Tor gateways', { exact: true })).toHaveValue(originalGateway);
  await expect(page.getByLabel('Balance RPC endpoints')).toHaveValue(originalRpcs);
  expect(await page.evaluate(() => localStorage.getItem('anonfolio.network.v1'))).toBeNull();
  await expect(page.locator('.amount')).toHaveText(['1', '0', '1', '0']);
});

test('blocked storage keeps the current settings and connection in use', async ({ page }) => {
  await mockConnection(page);
  await page.goto('/');
  await page.locator('#network-settings > summary').click();
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('Blocked'); }; });
  await page.getByRole('button', { name: 'Save settings and reconnect' }).click();
  await expect(page.locator('#settings-error')).toContainText('could not be saved');
  await expect(page.locator('#connection')).toContainText('Private worker ready');
});

test('pinned local startup never queries RPC directly; retries keep their private route', async ({ page }) => {
  const publicRequests: string[] = [];
  await page.route('https://**/*', async route => { publicRequests.push(route.request().url()); await route.abort('failed'); });
  // Exercise the actual Connection/provider, replacing only the Tor sandbox.
  await page.route('**/node_modules/.vite/deps/@anon-rpc_browser-harness.js*', route => route.fulfill({
    contentType: 'text/javascript', body: `
      import { WORKER_HASH_SELECTOR, WORKER_RESOLVERS_SELECTOR } from '/src/bootstrap.ts';
      window.__calls = [];
      export class AnonRpcWorker {
        constructor(options) {
          window.__workerConfig = options.config;
          this.ready = Promise.all([WORKER_HASH_SELECTOR,WORKER_RESOLVERS_SELECTOR].map(data => options.preExisting.rpcProvider.request({method:'eth_call',params:[{to:options.address,data},'latest']}))).then(metadata => { window.__metadata = metadata; });
        }
        acceptLog() { return new Promise(() => {}); }
        close() {}
        async fetch(url, init) {
          const body = JSON.parse(init.body);
          window.__calls.push({ url, body, key: init.anonOptions.isolationKey });
          if (window.__fail) throw new Error('private route unavailable');
          return Response.json({ jsonrpc: '2.0', id: body.id, result: body.method === 'eth_getBalance' ? (window.__ethBalance || '0xde0b6b3a7640000') : '0x' + '0'.repeat(64) });
        }
      }
    `,
  }));
  await page.addInitScript(() => localStorage.setItem('anonfolio.network.v1', JSON.stringify({
    bootstrapRpc:'https://old-direct-rpc.example/',rpcUrls:['https://private.example/rpc'],
    gateways:['152.236.3.22:12299:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ'],
  })));
  await page.goto('/');
  await expect(page.locator('#connection')).toContainText('Private worker ready');
  expect(await page.evaluate(() => (window as any).__workerConfig.gateways[0])).toContain(':12299:');
  expect(await page.evaluate(() => (window as any).__metadata[0])).toBe('0x5b62f358ce7a2b94ee9bc3a0e6a08757db68fa08fc348276f31eda788aec818b');
  await expect(page.getByLabel('Public discovery RPC')).toHaveCount(0);
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.amount')).toHaveText(['1']);
  await page.evaluate(() => { (window as any).__fail = true; });
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(page.locator('.balance small.error')).toHaveCount(2);
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls.length).toBeGreaterThanOrEqual(6);
  expect(calls.every((call: any) => call.url === 'https://private.example/rpc')).toBe(true);
  expect(new Set(calls.map((call: any) => call.key)).size).toBe(1);
  expect(publicRequests).toEqual([]);
});

test('named addresses use blockies in rows, avoid duplicate detail addresses, persist, and keep names out of RPC requests', async ({ page }) => {
  await mockConnection(page);
  const externalImages: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'image' && request.url().startsWith('https:')) externalImages.push(request.url()); });
  await page.goto('/');
  await page.getByLabel('Address name', { exact: false }).fill(' Savings ');
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.amount')).toHaveText(['1']);
  const row = page.locator('.wallet-head .address-display');
  await expect(row.locator('.address-name')).toHaveText('Savings');
  await expect(row.locator('.wallet-address')).toHaveText(a);
  const blockie = await row.locator('svg').innerHTML();
  await expect(row.locator('svg rect')).toHaveCount(64);
  await page.getByRole('button', { name: 'Details ' + a + ' · Savings', exact: true }).click();
  await expect(page.locator('.detail-inner .address-display')).toHaveCount(0);
  await expect(row.locator('.wallet-address')).toBeVisible();
  await expect(page.locator('.activity-item .address-display')).toHaveCount(0);
  await expect(page.locator('.activity')).not.toContainText(a);
  await expect(page.locator('.detail-inner')).not.toContainText('Private RPC operator:');
  expect(await page.evaluate(() => JSON.stringify((window as any).__calls))).not.toContain('Savings');
  await page.reload();
  await expect(page.locator('.wallet-head .address-name')).toHaveText('Savings');
  expect(await page.locator('.wallet-head svg.blockie').innerHTML()).toBe(blockie);
  await openAddressForm(page);
  await page.locator('#address').fill('Trading | ' + b + '\nUnnamed | 0x0000000000000000000000000000000000000003');
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.wallet-head .address-name')).toHaveText(['Savings', 'Trading', 'Unnamed']);
  expect(await page.locator('.wallet-head svg.blockie').nth(1).innerHTML()).not.toBe(blockie);
  expect(externalImages).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/named-addresses-mobile.png', fullPage: true });
});

test('names render as text and invalid named lists leave the watchlist unchanged', async ({ page }) => {
  await mockConnection(page);
  await page.goto('/');
  await page.locator('#address').fill('Good | ' + a + '\nBad | invalid');
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('#input-error')).not.toBeEmpty();
  await expect(page.locator('.wallet')).toHaveCount(0);
  await page.getByLabel('Address name', { exact: false }).fill('Ambiguous');
  await page.locator('#address').fill(a + '\n' + b);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('#input-error')).toContainText('one address');
  await expect(page.locator('.wallet')).toHaveCount(0);
  const name = '<img src=x onerror=alert(1)>';
  await page.getByLabel('Address name', { exact: false }).fill(name);
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.wallet-head .address-name')).toHaveText(name);
  await expect(page.locator('.address-display img')).toHaveCount(0);
});

test('header settings icon, responsive full addresses and application favicon', async ({ page }) => {
  await mockConnection(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await expect(settings).toBeVisible();
  await expect(page.locator('header #connection')).toBeVisible();
  await expect(page.locator('main #connection')).toHaveCount(0);
  await expect(page.locator('#connection')).toContainText('Private worker ready');
  await expect(page.locator('#connection')).toHaveText('Private worker ready');
  await expect(page.locator('details#connection, #connection summary, #connection button')).toHaveCount(0);
  await expect(page.locator('#connection')).not.toContainText('Tor gateway');
  await expect(page.locator('#connection')).not.toContainText('152.236.3.22');
  await expect(page.locator('#settings-panel')).not.toBeVisible();
  const box = await settings.boundingBox();
  expect(box!.y).toBeLessThan(80);
  expect(box!.x).toBeGreaterThan(1000);
  await settings.click();
  await expect(page.getByRole('region', { name: 'Application settings' })).toBeVisible();
  await expect(page.getByLabel('Tor gateways', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-panel')).not.toBeVisible();
  await expect(settings).toBeFocused();
  await settings.click();
  await page.getByRole('heading', { name: 'Portfolio', exact: true }).click();
  await expect(page.locator('#settings-panel')).not.toBeVisible();
  await page.locator('#address').fill('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.amount')).toHaveText(['1']);
  const address = page.locator('.wallet-head .wallet-address');
  await expect(address).toHaveText('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
  expect(await address.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  const iconUrl = await page.locator('link[rel="icon"]').getAttribute('href');
  expect(iconUrl).toBeTruthy();
  const icon = await page.request.get(iconUrl!);
  expect(icon.ok()).toBe(true);
  expect(await icon.text()).toContain('<svg');
  await expect.poll(() => page.locator('.brand-mark').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/header-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await address.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await settings.click();
  await expect(page.locator('#settings-panel')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/settings-popover-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.locator('#settings-panel')).not.toBeVisible();
  await page.screenshot({ path: 'test-results/header-mobile.png', fullPage: true });
});


test('address removal requires confirmation and cancellation preserves saved balances', async ({ page }) => {
  await mockConnection(page);
  await page.goto('/');
  await page.getByLabel('Address name', { exact: false }).fill('Savings');
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.amount')).toHaveText(['1']);
  const saved = await page.evaluate(() => localStorage.getItem('anonfolio.portfolio.v2'));
  const remove = page.getByRole('button', { name: 'Remove ' + a + ' · Savings', exact: true });
  await expect(remove).toBeHidden();
  await openWalletDetails(page, a + ' · Savings');
  await expect(page.locator('.balances .remove-address')).toHaveCount(0);
  await expect(page.locator('.details-toggle').first().locator('svg')).toBeVisible();
  const cancelled = page.waitForEvent('dialog');
  const cancelClick = remove.click();
  const prompt = await cancelled;
  expect(prompt.type()).toBe('confirm');
  expect(prompt.message()).toContain('Savings\n' + a);
  expect(prompt.message()).toContain('saved balances');
  await prompt.dismiss();
  await cancelClick;
  await expect(page.locator('.wallet')).toHaveCount(1);
  await expect(page.locator('.amount')).toHaveText(['1']);
  expect(await page.evaluate(() => localStorage.getItem('anonfolio.portfolio.v2'))).toBe(saved);
  await page.reload();
  await expect(page.locator('.wallet-head .address-name')).toHaveText('Savings');
  await expect(page.getByRole('button', { name: 'Refresh ' + a + ' · Savings', exact: true })).toBeEnabled();
  await openWalletDetails(page, a + ' · Savings');
  page.once('dialog', dialog => dialog.accept());
  await remove.click();
  await expect(page.locator('.wallet')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).wallets)).toEqual([]);
  await page.reload();
  await expect(page.locator('.wallet')).toHaveCount(0);
});


test('TWAP holding estimates, partial totals and custom quote settings persist', async ({ page }) => {
  await mockVerification(page, true);
  await mockConnection(page);
  await page.goto('/');
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.price-estimate')).toHaveText(['≈ 2000 USDC']);
  await expect(page.locator('.price-estimate').first()).toBeVisible();
  await expect(page.locator('#estimated-total .portfolio-value-amount')).toHaveText('≈ 2000 USDC');
  await expect(page.locator('#estimated-total .status-partial')).toHaveCount(0);
  await addToken(page);
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.locator('.price-estimate')).toHaveText(['≈ 2000 USDC', 'Unpriced']);
  await expect(page.locator('#estimated-total .valuation-coverage')).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Quote token', { exact: true }).selectOption('custom');
  await page.getByLabel('Quote contract address').fill('invalid');
  await page.getByLabel('Quote symbol').fill('CUSTOM');
  await page.getByLabel('Quote decimals').fill('18');
  await page.getByRole('button', { name: 'Save pricing and refresh' }).click();
  await expect(page.locator('#pricing-error')).toContainText('valid mainnet');
  await page.getByLabel('Quote contract address').fill(b);
  await page.getByLabel('Minimum quote-side liquidity').fill('100');
  await page.getByRole('button', { name: 'Save pricing and refresh' }).click();
  await expect(page.locator('#estimated-total .portfolio-value-amount')).toHaveText('— CUSTOM');
  await expect(page.locator('.price-estimate')).toHaveText(['Unpriced', 'Unpriced']);
  await page.reload();
  await expect(page.locator('#estimated-total .status-partial')).toHaveCount(1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Quote token', { exact: true })).toHaveValue('custom');
  await expect(page.getByLabel('Quote contract address')).toHaveValue(b);
  await expect(page.getByLabel('Minimum quote-side liquidity')).toHaveValue('100');
});

test('saved balance errors expose per-asset causes and recovery actions, then clear on success', async ({ page }) => {
  await mockConnection(page);
  await page.addInitScript(({ address, weth }) => {
    localStorage.setItem('anonfolio.portfolio.v2', JSON.stringify({ version: 3,
      tokens: [{ address: 'eth', symbol: 'ETH', decimals: 18 }, { address: weth, symbol: 'WETH', decimals: 18 }],
      wallets: [{ address, balances: { eth: { amount: '1000000000000000000', updatedAt: Date.now() - 60000 }, [weth]: { amount: '0', updatedAt: Date.now() - 60000 } } }] }));
  }, { address: a, weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' });
  await page.route('**/src/verification/client.ts*', route => route.fulfill({ contentType: 'text/javascript', body: `
    export async function verifyWallet(wallet, worker, tokens, emit) {
      const block={hash:'0x'+'11'.repeat(32),stateRoot:'0x'+'22'.repeat(32),number:'0x100',timestamp:Date.now()-60000};
      for(const token of tokens) {
        emit({type:'asset',asset:token.address});
        emit({type:'progress',message:'Fetching '+token.symbol+' proof at finalized block'});
        if(window.__recovered) emit({type:'balance',asset:token.address,amount:token.address==='eth'?'1000000000000000000':'0',decimals:18,block});
        else emit({type:'asset-error',asset:token.address,error:token.address==='eth'?'Error: Private eth_getProof rejected (-32602): distance to target block exceeds maximum proof window. https://user:password@rpc.example/key-secret?token=query-secret':'Bytecode hash does not match the verified account.'});
      }
      emit({type:'progress',message:'Later progress must not erase earlier failures'});
    }
  ` }));
  await page.goto('/');
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
  await expect(page.locator('.balance small.error button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(page.locator('.balance small.error button')).toHaveCount(2);
  for (const warning of await page.locator('.balance small.error button').all()) await expect(warning).toHaveAttribute('aria-description', /Unverified saved value · verification failed/);
  await expect(page.locator('.failure-link').first()).toHaveText('RPC cannot prove this finalized block · Details');
  const ethFailure = page.getByRole('region', { name: 'ETH balance failure', exact: true });
  await expect(ethFailure).toBeHidden();
  await page.getByRole('button', { name: 'Explain ETH failure for ' + a, exact: true }).click();
  await expect(ethFailure).toBeVisible();
  await expect(ethFailure).toContainText('distance to target block exceeds maximum proof window');
  await expect(ethFailure).toContainText('historical eth_getProof support');
  await expect(ethFailure.locator('.failure-message')).toBeHidden();
  await ethFailure.getByText('Technical details', { exact: true }).click();
  await expect(ethFailure.locator('.failure-message')).toBeVisible();
  await expect(ethFailure).toContainText('Step: Fetching ETH proof at finalized block');
  await expect(page.getByRole('region', { name: 'WETH balance failure', exact: true })).toContainText('Bytecode hash does not match');
  const saved = await page.evaluate(() => localStorage.getItem('anonfolio.portfolio.v2')!);
  expect(saved).toContain('maximum proof window'); expect(saved).not.toMatch(/password|key-secret|query-secret/);
  await expect(page.locator('body')).not.toContainText('password');
  await expect(page.getByRole('button', { name: 'Open network settings' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/balance-error-details.png', fullPage: true });
  await page.evaluate(() => { (window as any).__recovered = true; });
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(page.locator('.failure-link')).toHaveCount(0);
  await expect(page.locator('.read-failure')).toHaveCount(0);
  await expect(page.locator('.balance small.error')).toHaveCount(0);
});

test('an expired checkpoint explains checkpoint settings without an extra settings button', async ({ page }) => {
  await mockConnection(page);
  await page.route('**/src/verification/client.ts*', route => route.fulfill({ contentType: 'text/javascript', body: `
    export async function verifyWallet(wallet, worker, tokens, emit) {
      emit({type:'progress',message:'Checking the pinned consensus checkpoint'});
      throw new Error('Pinned consensus checkpoint is outside its 14-day trust window. A reviewed checkpoint update is required.');
    }
  ` }));
  await page.goto('/');
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.failure-link').first()).toHaveText('Consensus checkpoint needs updating · Details');
  await page.getByRole('button', { name: 'Explain ETH failure for ' + a, exact: true }).click();
  const report = page.getByRole('region', { name: 'ETH balance failure', exact: true });
  await expect(report).toContainText('outside its 14-day trust window');
  await expect(report).toContainText('updated application release with a reviewed mainnet checkpoint');
  await expect(report).toContainText('Changing RPC or gateway settings cannot renew the checkpoint');
  await expect(report.getByRole('button', { name: 'Open network settings' })).toHaveCount(0);
  await expect(page.locator('.amount')).toHaveText(['—', '—']);
});

test('private startup failures expose Tor warning causes, preserve wallet details and clear on recovery', async ({ page }) => {
  await page.route('https://**/*', route => route.abort('failed'));
  await page.route('**/node_modules/.vite/deps/@anon-rpc_browser-harness.js*', route => route.fulfill({
    contentType: 'text/javascript', body: `
      export class AnonRpcWorker {
        constructor() {
          this.logs = window.__recover ? [] : [
            {level:'warn',args:['tor-js worker: bootstrap attempt 1 failed; retrying:',{message:'Gateway connection refused',code:'ECONNREFUSED'}]},
            {level:'error',args:['Handshake failed at https://user:password@gateway.example/token-secret?key=secret']}
          ];
          this.ready = window.__recover ? Promise.resolve() : new Promise((resolve,reject) => setTimeout(() => reject({message:'Private connection unavailable; no unverified fallback.',cause:{message:'Tor bootstrap failed'}}),50));
        }
        acceptLog() { return this.logs.length ? Promise.resolve(this.logs.shift()) : new Promise(() => {}); }
        close() {}
      }
    `,
  }));
  await page.goto('/');
  await expect(page.locator('#connection strong')).toHaveAttribute('title', /Gateway connection refused \(ECONNREFUSED\)/);
  await expect(page.locator('#connection strong')).toHaveAttribute('title', /Tor bootstrap failed/);
  expect(await page.locator('#connection').textContent()).not.toMatch(/password|token-secret|key=secret/);
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.failure-link').first()).toBeVisible();
  await page.getByRole('button', { name: 'Explain ETH failure for ' + a, exact: true }).click();
  await expect(page.getByRole('region', { name: 'ETH balance failure', exact: true })).toContainText('Gateway connection refused');
  await page.reload();
  await page.getByRole('button', { name: 'Explain ETH failure for ' + a, exact: true }).click();
  await expect(page.getByRole('region', { name: 'ETH balance failure', exact: true })).toContainText('Tor bootstrap failed');
  await page.evaluate(() => { (window as any).__recover = true; });
  await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
  await expect(page.locator('#connection .connection-heading')).toContainText('Private worker ready');
  await expect(page.locator('#connection')).not.toContainText('ECONNREFUSED');
});


test('checkpoint settings validate, persist through reconnect and restore the release default', async ({ page }) => {
  await mockConnection(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const root = page.getByLabel('Mainnet checkpoint root', { exact: true });
  const slot = page.getByLabel('Checkpoint beacon slot', { exact: true });
  const defaultRoot = await root.inputValue();
  const defaultSlot = await slot.inputValue();
  await root.fill('0x1234');
  await page.getByRole('button', { name: 'Save settings and reconnect', exact: true }).click();
  await expect(page.locator('#settings-error')).toContainText('32-byte beacon block root');
  expect(await page.evaluate(() => localStorage.getItem('anonfolio.network.v1'))).toBeNull();
  const customRoot = '0x' + 'ab'.repeat(32);
  await root.fill(customRoot);
  await slot.fill('1');
  await page.getByRole('button', { name: 'Save settings and reconnect', exact: true }).click();
  await expect(page.locator('#settings-error')).toContainText('14-day trust window');
  await slot.fill(defaultSlot);
  await page.getByRole('button', { name: 'Save settings and reconnect', exact: true }).click();
  await expect(page.locator('#connection')).toContainText('Private worker ready');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(root).toHaveValue(customRoot);
  await expect(slot).toHaveValue(defaultSlot);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('anonfolio.network.v1')!).checkpoint)).toEqual({root:customRoot,slot:Number(defaultSlot)});
  await page.getByRole('button', { name: 'Restore defaults', exact: true }).click();
  await expect(page.locator('#connection')).toContainText('Private worker ready');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(root).toHaveValue(defaultRoot);
  await expect(slot).toHaveValue(defaultSlot);
});


test('manual PublicNode update accepts mixed HTTPS/KPS resolvers, caches on save and rejects corruption', async ({ page }) => {
  const bundle = '// user-selected Tor worker fixture';
  const hash = keccak256(stringToBytes(bundle));
  const resolver = 'https://tor-download.example/anon-rpc-worker.js';
  const requests: any[] = [];
  await page.route('**/node_modules/.vite/deps/@anon-rpc_browser-harness.js*', route => route.fulfill({ contentType:'text/javascript',body:`
    import { WORKER_HASH_SELECTOR, WORKER_RESOLVERS_SELECTOR } from '/src/bootstrap.ts';
    export class AnonRpcWorker {
      constructor(options) {
        this.ready = Promise.all([WORKER_HASH_SELECTOR,WORKER_RESOLVERS_SELECTOR].map(data => options.preExisting.rpcProvider.request({method:'eth_call',params:[{to:options.address,data},'latest']})))
          .then(values => {window.__selectedWorkerHash=values[0];});
      }
      acceptLog() {return new Promise(() => {});}
      close() {}
    }
  ` }));
  await page.route('https://ethereum-rpc.publicnode.com/', route => {
    const body = route.request().postDataJSON(); requests.push(body);
    const result = body.method === 'eth_blockNumber' ? '0x123' : body.id === 2 ? hash : encodeAbiParameters([{type:'string[]'}], [[resolver, 'kps:152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ/keccak/worker']]);
    return route.fulfill({json:{jsonrpc:'2.0',id:body.id,result}});
  });
  let downloads = 0;
  await page.route(resolver, route => { downloads++; return route.fulfill({body:bundle,contentType:'text/javascript'}); });
  await page.goto('/');
  await expect(page.locator('#connection')).toContainText('Private worker ready');
  expect(requests).toHaveLength(0); expect(downloads).toBe(0);
  await page.getByRole('button', {name:'Settings',exact:true}).click();
  await page.getByRole('button', {name:'Update Tor worker from PublicNode',exact:true}).click();
  await expect(page.locator('#tor-worker-status')).toContainText('Update downloaded and hash-checked');
  await expect(page.locator('#tor-worker-metadata')).toContainText(hash);
  await expect(page.locator('#tor-worker-metadata')).toContainText(resolver);
  expect(await page.evaluate(() => localStorage.getItem('anonfolio.network.v1'))).toBeNull();
  expect(requests.map(body => body.method)).toEqual(['eth_blockNumber','eth_call','eth_call']);
  expect(requests.slice(1).every(body => body.params[0].to.toLowerCase() === '0x700da3193d35fa54cd3fbf29b66f2a2a0385659e' && body.params[1] === '0x123')).toBe(true);
  await page.getByRole('button', {name:'Save settings and reconnect',exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).__selectedWorkerHash)).toBe(hash);
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__selectedWorkerHash)).toBe(hash);
  expect(requests).toHaveLength(3); expect(downloads).toBe(1);
  await page.evaluate(async () => {
    const cache = await caches.open('anonfolio-user-tor-worker-v1');
    for (const key of await cache.keys()) await cache.put(key, new Response('tampered'));
  });
  await page.reload();
  await expect(page.locator('#connection strong')).toHaveAttribute('title', /Saved Tor worker digest mismatch/);
  expect(requests).toHaveLength(3); expect(downloads).toBe(1);
  await page.getByRole('button', {name:'Settings',exact:true}).click();
  await page.getByLabel('Tor worker source',{exact:true}).selectOption('bundled');
  await page.getByRole('button', {name:'Save settings and reconnect',exact:true}).click();
  await expect(page.locator('#connection')).toContainText('Private worker ready');
  expect(requests).toHaveLength(3); expect(downloads).toBe(1);
});

for (const failure of ['RPC outage', 'digest mismatch']) test('manual worker update preserves the current worker on ' + failure, async ({page}) => {
  await mockConnection(page);
  await page.route('https://ethereum-rpc.publicnode.com/', route => {
    const body = route.request().postDataJSON();
    if (failure === 'RPC outage') return route.fulfill({status:503,body:'unavailable'});
    return route.fulfill({json:{jsonrpc:'2.0',id:body.id,result:body.method === 'eth_blockNumber' ? '0x123' : body.id === 2 ? '0x'+'ab'.repeat(32) : encodeAbiParameters([{type:'string[]'}], [['https://tor-download.example/worker.js']])}});
  });
  await page.route('https://tor-download.example/worker.js', route => route.fulfill({body:'tampered worker'}));
  await page.goto('/');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Update Tor worker from PublicNode',exact:true}).click();
  await expect(page.locator('#tor-worker-status')).toContainText(failure === 'RPC outage' ? 'HTTP 503' : 'digest mismatch');
  await expect(page.locator('#tor-worker-status')).toContainText('Your current worker is unchanged');
  await expect(page.getByLabel('Tor worker source',{exact:true})).toHaveValue('bundled');
  expect(await page.evaluate(() => localStorage.getItem('anonfolio.network.v1'))).toBeNull();
});

test('failure cards identify the actual service and do not blame the wallet RPC for generic fetch failures', async ({ page }) => {
  await mockConnection(page);
  await page.route('**/src/verification/client.ts*', route => route.fulfill({ contentType:'text/javascript', body:`
    export async function verifyWallet(wallet,worker,tokens,emit) {
      const errors={consensus:'Consensus GET beacon.example/eth/v1/beacon/light_client/bootstrap/0x123 response could not be read: Failed to fetch',
        verifier:'Helios WASM download from app.example failed: Failed to fetch', generic:'Failed to fetch'};
      throw new Error(errors[window.__failureService || 'consensus']);
    }
  ` }));
  await page.goto('/');
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await page.getByRole('button', { name: 'Explain ETH failure for ' + a, exact:true }).click();
  const failure = page.getByRole('region', { name: 'ETH balance failure', exact:true });
  await expect(failure.locator('.failure-metadata')).toContainText('Consensus API');
  await expect(failure.locator('.failure-metadata')).toContainText('beacon.example');
  await expect(failure.locator('.failure-metadata')).not.toContainText('eth.drpc.org');
  await page.evaluate(() => { (window as any).__failureService='verifier'; });
  await page.getByRole('button', { name: 'Refresh ' + a, exact:true }).click();
  await expect(failure.locator('.failure-metadata')).toContainText('Application host');
  await expect(failure.locator('.failure-metadata')).toContainText('app.example');
  await page.evaluate(() => { (window as any).__failureService='generic'; });
  await page.getByRole('button', { name: 'Refresh ' + a, exact:true }).click();
  await expect(failure).toContainText('Failed to fetch');
  await expect(failure.locator('.failure-metadata')).not.toContainText('RPC');
  await expect(failure.locator('.failure-metadata')).not.toContainText('eth.drpc.org');
});

async function stalledVerifier(page: Page) {
  await page.unroute('**/src/verification/client.ts*');
  await mockConnection(page);
  await page.addInitScript(() => {
    (window as any).__verifiers=[];
    (window as any).Worker = class {
      onmessage: any; onerror: any; request: any; sent: any[]=[]; terminated=false;
      constructor() { (window as any).__verifiers.push(this); }
      postMessage(request: any) { this.sent.push(request); if(request.type==='refresh') this.request=request; }
      terminate() { this.terminated=true; }
    };
  });
}

test('queued addresses do not spin and a failed active read stops before retry backoff', async ({page}) => {
  await stalledVerifier(page);
  await page.goto('/');
  await page.locator('#address').fill(a+'\n'+b);
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  const first=page.locator('.wallet').nth(0), second=page.locator('.wallet').nth(1);
  await expect(first.locator('.refresh-icon .spinner')).toHaveCount(1);
  await expect(second.locator('.refresh-icon')).toHaveAttribute('title', 'Queued for verification');
  await expect(second.locator('.spinner')).toHaveCount(0);
  await page.evaluate(() => {
    const worker=(window as any).__verifiers[0];
    worker.onmessage({data:{type:'fatal',run:worker.request.id,error:'Private eth_getProof failed: Tor route unavailable'}});
  });
  await expect(first).toHaveAttribute('data-loading','false');
  await expect(first.locator('.spinner')).toHaveCount(0);
  await expect(first.locator('.activity')).toContainText('Automatic retry');
  await expect(first.locator('.refresh-icon')).toBeEnabled();
  await expect(second.locator('.refresh-icon .spinner')).toHaveCount(1);
  expect(await page.evaluate(()=>(window as any).__verifiers[0].terminated)).toBe(true);
  await page.evaluate(() => {
    const worker=(window as any).__verifiers[1];
    worker.onmessage({data:{type:'fatal',run:worker.request.id,error:'Private route unavailable'}});
  });
  await expect(page.locator('.wallet .spinner')).toHaveCount(0);
});

test('an unresponsive verifier times out, terminates and clears every wallet spinner', async ({page}) => {
  await page.clock.install();
  await stalledVerifier(page);
  await page.goto('/');
  await page.locator('#address').fill(a);
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await expect(page.locator('.wallet .refresh-icon .spinner')).toHaveCount(1);
  await page.clock.fastForward(300_001);
  await expect(page.locator('.wallet')).toHaveAttribute('data-loading','false');
  await expect(page.locator('.wallet .spinner')).toHaveCount(0);
  await expect(page.locator('.activity')).toContainText('Automatic retry');
  await expect(page.locator('.refresh-icon')).toBeEnabled();
  await expect(page.locator('.failure-link').first()).toContainText('Verification timed out');
  expect(await page.evaluate(()=>(window as any).__verifiers[0].terminated)).toBe(true);
});

test('verification progress distinguishes consensus, actual private requests and local work', async ({page}) => {
  await page.clock.install();
  await stalledVerifier(page);
  await page.goto('/');
  await page.locator('#address').fill(a);
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await openWalletDetails(page,a);
  const panel = page.getByRole('region',{name:'Verification progress',exact:true});
  async function emit(event: object) {
    await page.evaluate(event => {
      const worker=(window as any).__verifiers[0];
      worker.onmessage({data:{...event,run:worker.request.id}});
    },event);
  }
  await emit({type:'progress',stage:'consensus',message:'Checking finalized headers.'});
  await expect(panel.locator('[aria-current="step"]')).toHaveText('Consensus');
  await expect(page.locator('.activity-item.waiting').first()).toContainText('Pending');
  await expect(page.locator('.activity-item.waiting').first()).not.toContainText('eth_getProof');
  const startedAt = await page.evaluate(()=>Date.now());
  const request={requestId:1,method:'GET eth/v1/beacon/light_client/updates',host:'beacon.example',state:'waiting',startedAt,deadline:startedAt+90_000};
  await emit({type:'network',request});
  await expect(panel).toContainText('Submitted to Anon-RPC · waiting for response headers');
  await page.clock.fastForward(12_000);
  await expect(panel).toContainText('12s elapsed · request timeout in 78s');
  await emit({type:'network',request:{...request,state:'reading'}});
  await expect(panel).toContainText('Response headers received · reading response body');
  await emit({type:'network',request:{...request,state:'received'}});
  await emit({type:'asset',asset:'eth'});
  await emit({type:'progress',stage:'balances',message:'Checking account and requested storage proofs against finalized state root.'});
  await expect(panel.locator('[aria-current="step"]')).toHaveText('Balances');
  await expect(panel.locator('.progress-request')).toHaveCount(0);
  await expect(panel).toContainText('Checking account and requested storage proofs');
  await page.screenshot({path:'/tmp/anonfolio-progress-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/anonfolio-progress-mobile.png',fullPage:true});
  await emit({type:'fatal',error:'Private eth_getProof failed: Tor route unavailable'});
  await expect(panel).toContainText('No request running');
  await expect(panel.locator('[data-progress-start], [aria-current="step"]')).toHaveCount(0);
  await expect(page.locator('.wallet .spinner')).toHaveCount(0);
});

test('parallel prices remain hidden until the matching finalized balance is proven', async ({page}) => {
  await stalledVerifier(page);
  await page.goto('/');
  await page.locator('#address').fill(a);
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await openWalletDetails(page,a);
  await page.evaluate(() => {
    const worker=(window as any).__verifiers[0];
    const emit=(event:object)=>worker.onmessage({data:{...event,run:worker.request.id}});
    const block={hash:'0x'+'11'.repeat(32),stateRoot:'0x'+'22'.repeat(32),number:'0x100',timestamp:Date.now()-60000};
    (window as any).__parallelBlock=block;
    emit({type:'progress',stage:'balances-pricing',message:'Proving balances and reading verified price oracles in parallel.'});
    emit({type:'asset',asset:'eth',stage:'balances-pricing'});
    emit({type:'price-start',asset:'eth',stage:'balances-pricing'});
    emit({type:'price',asset:'eth',block,estimate:{pool:'0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',quote:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',symbol:'USDC',decimals:6,numerator:'2000000000',denominator:'1000000000000000000',window:1800,blockHash:block.hash,minLiquidity:'10000'}});
  });
  await expect(page.locator('.verification-stages [aria-current="step"]')).toHaveText(['Balances','Prices']);
  await expect(page.locator('.progress-heading')).toContainText('Verifying balances and prices');
  await expect(page.locator('.amount').first()).toHaveText('—');
  await expect(page.locator('.price-estimate').first()).toHaveText('Unpriced');
  await page.evaluate(() => {
    const worker=(window as any).__verifiers[0];
    worker.onmessage({data:{type:'balance',run:worker.request.id,asset:'eth',amount:'1000000000000000000',block:(window as any).__parallelBlock}});
  });
  await expect(page.locator('.amount').first()).toHaveText('1');
  await expect(page.locator('.price-estimate').first()).toHaveText('≈ 2000 USDC');
  await page.evaluate(() => {
    const worker=(window as any).__verifiers[0];
    worker.onmessage({data:{type:'fatal',run:worker.request.id,error:'Remaining private request failed'}});
  });
  await expect(page.locator('.wallet .spinner')).toHaveCount(0);
  await expect(page.locator('.amount').first()).toHaveText('1');
});

for (const viewport of [{width:1280,height:800},{width:390,height:844}]) test(`open address details stay stable through loading updates at ${viewport.width}px`, async ({page}) => {
  await page.setViewportSize(viewport);
  await stalledVerifier(page);
  await page.goto('/');
  await page.locator('#address').fill(a+'\n'+b);
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await openWalletDetails(page,a);
  const samples: {height:number; top:number; next:number; row:number; page:number; table:number}[]=[];
  async function sample(event?:object) {
    if(event) await page.evaluate(event=>{
      const worker=(window as any).__verifiers[0];
      worker.onmessage({data:{...event,run:worker.request.id}});
    },event);
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));
    samples.push(await page.evaluate(()=>{
      const first=document.querySelector('.detail-inner')!.getBoundingClientRect();
      return {height:first.height,top:first.top,next:document.querySelectorAll('.balances')[1].getBoundingClientRect().top-first.top,
        row:document.querySelector('.balances')!.getBoundingClientRect().height,
        page:window.scrollY,table:document.querySelector('#wallets')!.scrollTop};
    }));
  }
  // Put the reader part-way down the portfolio, where anchoring can amplify shifts.
  await page.evaluate(()=>window.scrollTo(0,150));
  await sample();
  await sample({type:'progress',stage:'consensus',message:'Verifying finalized signatures.'});
  const startedAt=Date.now();
  const request={requestId:1,method:'GET eth/v1/beacon/light_client/updates',host:'ethereum-beacon-api.publicnode.com',state:'waiting',startedAt,deadline:startedAt+90_000};
  await sample({type:'network',request});
  await sample({type:'network',request:{...request,requestId:2,method:'eth_getProof'}});
  await sample({type:'network',request:{...request,state:'reading'}});
  await sample({type:'network',request:{...request,state:'received'}});
  await sample({type:'network',request:{...request,requestId:2,state:'received'}});
  await sample({type:'asset',asset:'eth',stage:'balances-pricing'});
  await sample({type:'progress',stage:'balances-pricing',message:'Checking account and requested storage proofs against the verified finalized state root, while the independent oracle lane executes balance-independent pricing calls locally. '.repeat(6)});
  await sample({type:'network',request:{...request,requestId:3}});
  await sample({type:'network',request:{...request,requestId:4}});
  const block={hash:'0x'+'11'.repeat(32),stateRoot:'0x'+'22'.repeat(32),number:'0x100',timestamp:Date.now()-60_000};
  await sample({type:'balance',asset:'eth',amount:'1000000000000000000',block});
  await sample({type:'asset-error',asset:'0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',error:'Contract balance proof failed'});
  await sample({type:'price-error',asset:'eth',error:'No direct pool qualifies'});
  await sample({type:'done'});
  await page.screenshot({path:'/tmp/anonfolio-stable-details-'+viewport.width+'.png',fullPage:true});
  for(const key of ['height','top','next','row','page','table'] as const) {
    const values=samples.map(sample=>sample[key]);
    expect(Math.max(...values)-Math.min(...values),key+' changed across progress events: '+JSON.stringify(values)).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button',{name:'Explain WETH failure for '+a,exact:true}).click();
  const technical=page.getByRole('region',{name:'WETH balance failure',exact:true}).locator('.failure-technical');
  await technical.evaluate(node=>(node as HTMLDetailsElement).open=true);
  await page.evaluate(()=>{const worker=(window as any).__verifiers[0];worker.onmessage({data:{type:'progress',run:worker.request.id,message:'An unrelated progress update'}});});
  await expect(technical).toHaveJSProperty('open',true);
});

test('compact status icons explain verification, proven zero, missing prices and saved or failed reads', async ({page}) => {
  await mockConnection(page);
  await mockVerification(page,true);
  await page.goto('/');
  await addToken(page);
  await openAddressForm(page);
  await page.locator('#address').fill(a);
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await expect(page.locator('.amount')).toHaveText(['1','1.23']);
  const eth=page.locator('.balance[data-asset="eth"]'), weth=page.locator('.balance[data-asset="0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"]'), custom=page.locator('.balance[data-asset="'+usdc+'"]');
  await expect(page.locator('.zero-holdings')).toHaveCount(0);
  const proven=eth.getByRole('img',{name:'Verified finalized',exact:true});
  await expect(proven.locator('svg')).toBeVisible();
  await proven.hover();
  await expect(proven).toHaveAttribute('title','Verified finalized');
  await expect(weth).toHaveCount(0);
  await expect(custom.locator('.price-estimate').getByRole('img')).toHaveAttribute('title',/Unpriced: No direct pool qualifies/);
  await expect(page.getByRole('columnheader', { name: 'Status', exact: true })).toHaveCount(0);
  await expect(page.locator('.row-status')).toHaveCount(0);
  for(const node of await page.locator('.status-icon').all()) {
    await expect(node).toHaveAttribute('title',/.+/);
    await expect(node).toHaveAttribute('aria-label',/.+/);
    // Labels remain available to assistive technology, without visible repeated text.
    await expect(node.locator('.sr-only')).toHaveCSS('position','absolute');
  }
  await proven.focus();
  await expect(proven).toBeFocused();
  await page.screenshot({path:'/tmp/anonfolio-status-icons.png',fullPage:true});
  await page.unroute('**/src/connection.ts*');
  await mockConnection(page,true,true);
  await page.reload();
  await expect(page.locator('.balance small.cached .status-saved')).toHaveCount(3);
  await expect(page.locator('.balance small.cached .status-saved').first()).toHaveAttribute('title','Saved verified balance; refresh to check for updates.');
  await page.evaluate(()=>(window as any).__releaseConnection());
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(page.locator('.balance small.error .status-stale')).toHaveCount(3);
  const explain=page.getByRole('button',{name:'Explain ETH failure for '+a,exact:true});
  await expect(explain.locator('svg')).toBeVisible();
  await expect(explain).toHaveAttribute('title',/private connection unavailable/);
  await explain.click();
  await expect(page.getByRole('region',{name:'ETH balance failure',exact:true})).toBeVisible();
});

test('refresh preserves focus on the same address and token when status icons share labels', async ({page}) => {
  await mockConnection(page);
  await page.goto('/');
  await addToken(page);
  await openAddressForm(page);
  await page.locator('#address').fill(a+'\n'+b);
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await expect(page.locator('.amount')).toHaveText(['1','1.23','1','1.23']);
  const icon=page.locator('.wallet').nth(1).locator('.balance[data-asset="'+usdc+'"]').getByRole('img',{name:'Verified finalized',exact:true});
  await icon.focus();
  await page.locator('.refresh-icon').first().evaluate(button=>(button as HTMLButtonElement).click());
  await expect(icon).toBeFocused();
  await expect(page.locator('.refresh-icon').first()).toBeEnabled();
  await expect(icon).toBeFocused();
});

test('portfolio value and token subtotals sum each address quote with explicit partial coverage', async ({page}) => {
  await mockConnection(page);
  await page.route('**/src/verification/client.ts*',route=>route.fulfill({contentType:'text/javascript',body:`
    export async function verifyWallet(wallet,worker,tokens,emit) {
      if(window.__failValuation) throw new Error('Private route unavailable');
      const first=wallet.address.toLowerCase()==='${a}';
      const block={hash:'0x'+(first?'11':'22').repeat(32),stateRoot:'0x'+'33'.repeat(32),number:'0x100',timestamp:Date.now()-60000};
      for(const token of tokens) {
        const native=token.address==='eth', quote=token.symbol==='USDC';
        const amount=quote?(first?5000000n:7000000n):native?(first?10n**18n:3n*10n**18n):(first?2n*10n**18n:4n*10n**18n);
        emit({type:'balance',asset:token.address,amount:amount.toString(),block});
        if(!first&&!native&&!quote) {emit({type:'price-error',asset:token.address,error:'No direct pool qualifies'});continue;}
        emit({type:'price',asset:token.address,block,estimate:{pool:'0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',quote:'${usdc}',symbol:'USDC',decimals:6,numerator:quote?'1':first?'2000000000':'1000000000',denominator:quote?'1':'1000000000000000000',window:1800,blockHash:block.hash,minLiquidity:'10000'}});
      }
    }
  `}));
  await page.goto('/');
  await addToken(page);
  await openAddressForm(page);
  await page.locator('#address').fill(a+'\n'+b);
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await expect(page.locator('.total-amount')).toHaveText(['4','6','12']);
  await expect(page.locator('.token-value-amount')).toHaveText(['≈ 5000 USDC','≈ 4000 USDC','≈ 12 USDC']);
  await expect(page.locator('#estimated-total .portfolio-value-amount')).toHaveText('≈ 9012 USDC');
  await expect(page.locator('#estimated-total .valuation-coverage')).toHaveCount(0);
  await expect(page.locator('#estimated-total .status-partial')).toHaveAttribute('title',/only 5 of 6/);
  await expect(page.locator('#estimated-total .status-unverified')).toHaveAttribute('title',/different verified finalized blocks/);
  await expect(page.locator('.token-value').nth(0)).toHaveAttribute('data-state','complete');
  await expect(page.locator('.token-value').nth(2)).toHaveAttribute('data-state','complete');
  await expect(page.locator('.token-value').nth(1)).toHaveAttribute('data-state','partial');
  await expect(page.locator('.token-value').nth(1).getByRole('img',{name:/Partial value/})).toHaveAttribute('title',/only 1 of 2/);
  await expect(page.locator('#estimated-total').getByRole('img',{name:/Estimated using/})).toHaveAttribute('title',/30-minute Uniswap v3 TWAPs/);
  await page.screenshot({path:'/tmp/anonfolio-value-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'/tmp/anonfolio-value-mobile.png',fullPage:true});
  await page.evaluate(()=>{(window as any).__failValuation=true;});
  await page.getByRole('button',{name:'Refresh '+a,exact:true}).click();
  await expect(page.locator('.token-value-amount')).toHaveText(['≈ 5000 USDC','≈ 4000 USDC','≈ 12 USDC']);
  await expect(page.locator('#estimated-total .status-stale')).toHaveAttribute('title',/3 saved or stale/);
});

test('read history groups shared blocks and keeps read times without displaying block hashes', async ({page}) => {
  await mockConnection(page);
  await page.goto('/');
  await page.locator('#address').fill(a);
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await expect(page.locator('.amount')).toHaveText(['1']);
  await openWalletDetails(page,a);
  await page.locator('.history-details > summary').first().click();
  const history=page.getByRole('region',{name:'Balance read history',exact:true});
  await expect(history.locator('.read-snapshot')).toHaveCount(1);
  await expect(history.locator('tbody th')).toHaveText(['ETH','WETH']);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).wallets[0].balances);
  for(const [index,asset] of ['eth','0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'].entries()) {
    await expect(history.locator('tbody time').nth(index)).toHaveAttribute('datetime',new Date(saved[asset].updatedAt).toISOString());
  }
  await expect(history.locator('.snapshot-time time')).toHaveAttribute('datetime',new Date(saved.eth.verifiedBlock.timestamp).toISOString());
  await expect(history.getByText('Block hash',{exact:true})).toHaveCount(0);
  await expect(history).not.toContainText(saved.eth.verifiedBlock.hash);
  await page.evaluate(()=>{(window as any).__delay=2000;});
  await page.getByRole('button',{name:'Refresh '+a,exact:true}).click();
  await expect(page.locator('.history-details')).toHaveJSProperty('open',true);
  await expect(page.getByRole('button',{name:'Refresh '+a,exact:true})).toBeEnabled();
  await expect(page.locator('.history-details')).toHaveJSProperty('open',true);
  await page.screenshot({path:'/tmp/anonfolio-read-history-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'/tmp/anonfolio-read-history-mobile.png',fullPage:true});
  // Distinct finalized blocks must never be represented by one shared header.
  await page.evaluate(()=>{
    const key='anonfolio.portfolio.v2', data=JSON.parse(localStorage.getItem(key)!);
    data.wallets[0].balances['0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'].verifiedBlock.hash='0x'+'44'.repeat(32);
    localStorage.setItem(key,JSON.stringify(data));
  });
  await page.unroute('**/src/connection.ts*');
  await mockConnection(page,true);
  await page.reload();
  await openWalletDetails(page,a);
  await page.locator('.history-details > summary').first().click();
  await expect(history.locator('.read-snapshot')).toHaveCount(2);
  await expect(history.locator('.read-snapshot').nth(0).locator('tbody th')).toContainText('ETH');
  await expect(history.locator('.read-snapshot').nth(1).locator('tbody th')).toContainText('WETH');
});

test('read history keeps legacy saved values separate from tokens with no successful read', async ({page}) => {
  await mockConnection(page,true,true);
  const timestamp=Date.now()-60_000;
  await page.addInitScript(({address,weth,timestamp})=>{
    localStorage.setItem('anonfolio.portfolio.v2',JSON.stringify({version:3,
      tokens:[{address:'eth',symbol:'ETH',decimals:18},{address:weth,symbol:'WETH',decimals:18}],
      wallets:[{address,balances:{eth:{amount:'1000000000000000000',updatedAt:timestamp}}}]}));
  },{address:a,weth:'0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',timestamp});
  await page.goto('/');
  await openWalletDetails(page,a);
  await page.locator('.history-details > summary').first().click();
  const history=page.getByRole('region',{name:'Balance read history',exact:true});
  const legacy=history.getByRole('article',{name:'Unverified saved values',exact:true});
  const pending=history.getByRole('article',{name:'Awaiting first read',exact:true});
  await expect(legacy.locator('tbody th')).toContainText('ETH');
  await expect(legacy.locator('tbody time')).toHaveAttribute('datetime',new Date(timestamp).toISOString());
  await expect(pending.locator('tbody th')).toHaveText('WETH');
  await expect(pending.locator('tbody td')).toHaveText('—');
  await expect(history.locator('.snapshot-hash')).toHaveCount(0);
  await page.evaluate(()=>(window as any).__releaseConnection());
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(pending.getByRole('img',{name:/no successful read is available/})).toBeVisible();
  await expect(legacy.locator('tbody time')).toHaveAttribute('datetime',new Date(timestamp).toISOString());
});

test('expandable timestamped retrieval stream keeps history, follows new entries and preserves scrollback',async({page})=>{
  await page.clock.install();
  await stalledVerifier(page);
  await page.goto('/');
  await page.locator('#address').fill(a+'\n'+b);
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await openWalletDetails(page,a);
  const log=page.locator('.wallet').first().locator('.retrieval-log'), stream=log.locator('.log-stream');
  async function emit(event:object) {
    await page.evaluate(event=>{const worker=(window as any).__verifiers[0];worker.onmessage({data:{...event,run:worker.request.id}});},event);
  }
  await emit({type:'progress',stage:'consensus',message:'Checkpoint signatures accepted'});
  await expect(stream).not.toBeVisible();
  await log.locator('summary').click();
  await expect(stream).toContainText('Checkpoint signatures accepted');
  await page.clock.fastForward(25);
  const startedAt=await page.evaluate(()=>Date.now());
  const request={requestId:9,method:'eth_getProof',host:'rpc.example',startedAt,deadline:startedAt+90_000};
  for(const state of ['waiting','reading','received']) await emit({type:'network',request:{...request,state}});
  await expect(stream).toContainText('Response headers received');
  await expect(stream).toContainText('Response body received');
  await page.evaluate(()=>{
    const worker=(window as any).__verifiers[0];
    for(let i=0;i<65;i++) worker.onmessage({data:{type:'progress',run:worker.request.id,message:'Proof step '+i+': verifying account and requested storage witnesses.'}});
  });
  expect(await stream.evaluate(node=>node.lastElementChild!.getBoundingClientRect().bottom-document.querySelector('#wallets')!.getBoundingClientRect().bottom)).toBeLessThanOrEqual(1);
  await stream.evaluate(node=>{node.focus({preventScroll:true});const root=document.querySelector('#wallets')!;root.scrollTop+=node.firstElementChild!.getBoundingClientRect().top-root.getBoundingClientRect().top-44;});
  const scrollback=await page.locator('#wallets').evaluate(node=>node.scrollTop);
  await emit({type:'progress',message:'A newer message while reading earlier entries'});
  await expect(stream).toBeFocused();
  expect(await page.locator('#wallets').evaluate(node=>node.scrollTop)).toBeCloseTo(scrollback,0);
  await log.locator('summary').click();
  await emit({type:'progress',message:'Message received while the stream is collapsed'});
  await log.locator('summary').click();
  await expect(stream).toContainText('Proof step 0');
  await expect(stream).toContainText('Message received while the stream is collapsed');
  const block={hash:'0x'+'11'.repeat(32),stateRoot:'0x'+'22'.repeat(32),number:'0x100',timestamp:Date.now()-60000};
  await emit({type:'balance',asset:'eth',amount:'0',block});
  await emit({type:'fatal',error:'Private route timed out'});
  await expect(log).toHaveJSProperty('open',true);
  await expect(stream).toContainText('Balance proved');
  await expect(stream).toContainText('Private route timed out');
  await expect(stream).toContainText('Automatic retry');
  const timestamps=await stream.locator('time').evaluateAll(nodes=>nodes.map(node=>({text:node.textContent,at:Date.parse(node.getAttribute('datetime')!)})));
  expect(timestamps).toHaveLength(await stream.locator('li').count());
  expect(timestamps.every((entry,index)=>/^\d{2}:\d{2}:\d{2}\.\d{3}$/.test(entry.text!)&&Number.isFinite(entry.at)&&(!index||entry.at>=timestamps[index-1]!.at))).toBe(true);
  expect(new Set(timestamps.map(entry=>entry.at)).size).toBeGreaterThan(1);
  await openWalletDetails(page,b);
  const secondLog=page.locator('.wallet').nth(1).locator('.retrieval-log');
  await secondLog.locator('summary').click();
  await expect(secondLog).not.toContainText('Checkpoint signatures accepted');
  await page.screenshot({path:'/tmp/anonfolio-retrieval-log-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'/tmp/anonfolio-retrieval-log-mobile.png',fullPage:true});
});

for(const available of [true,false]) test('proof-window '+(available?'recovery':'exhaustion')+' stays on private configured RPCs',async({page})=>{
  await stalledVerifier(page);
  await page.addInitScript(()=>{
    localStorage.setItem('anonfolio.network.v1',JSON.stringify({gateways:['152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ'],rpcUrls:['https://short.example/','https://history.example/']}));
  });
  await page.route('**/src/connection.ts*',route=>route.fulfill({contentType:'text/javascript',body:`
    window.__proofCalls=[];
    export class Connection {
      constructor(state) {this.state=state;}
      get() {this.state('ready');return Promise.resolve({fetch:async(url,init)=>{
        const body=JSON.parse(init.body);window.__proofCalls.push({url,body,key:init.anonOptions.isolationKey});
        return Response.json(url.includes('short.example')||!${available}?{jsonrpc:'2.0',id:body.id,error:{code:-32602,message:'distance to target block exceeds maximum proof window'}}:{jsonrpc:'2.0',id:body.id,result:'0x'});
      }});}
      close() {}
    }
  `}));
  const ordinary:string[]=[];
  page.on('request',request=>{if(/https:\/\/(short|history)\.example/.test(request.url()))ordinary.push(request.url());});
  await page.goto('/');
  await page.locator('#address').fill(a);
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await openWalletDetails(page,a);
  await page.evaluate(async()=>{
    const worker=(window as any).__verifiers[0];
    await worker.onmessage({data:{type:'rpc',run:worker.request.id,id:9,body:{jsonrpc:'2.0',id:1,method:'eth_getProof',params:[worker.request.address,[],{blockHash:'0x'+'11'.repeat(32)}]}}});
  });
  const calls=await page.evaluate(()=>(window as any).__proofCalls);
  expect(calls.map((call:any)=>call.url)).toEqual(['https://short.example/','https://history.example/']);
  expect(calls[0].body).toEqual(calls[1].body);
  expect(calls[0].key).toBe(calls[1].key);
  expect(ordinary).toEqual([]);
  if(available) {
    expect(await page.evaluate(()=>(window as any).__verifiers[0].sent.some((message:any)=>message.type==='reply'&&message.id===9))).toBe(true);
    await page.evaluate(async()=>{
      const worker=(window as any).__verifiers[0];
      await worker.onmessage({data:{type:'rpc',run:worker.request.id,id:10,body:{jsonrpc:'2.0',id:2,method:'eth_getCode',params:['0x0000000000000000000000000000000000000001',{blockHash:'0x'+'11'.repeat(32)}]}}});
    });
    expect(await page.evaluate(()=>(window as any).__proofCalls.at(-1).url)).toBe('https://history.example/');
    await page.locator('.retrieval-log > summary').click();
    await expect(page.locator('.log-stream')).toContainText('short.example cannot serve proofs');
    await expect(page.locator('.log-stream')).toContainText('same address isolation key');
    await expect(page.locator('.read-failure')).toHaveCount(0);
    await page.evaluate(()=>{
      const worker=(window as any).__verifiers[0], run=worker.request.id;
      const block={hash:'0x'+'11'.repeat(32),stateRoot:'0x'+'22'.repeat(32),number:'0x100',timestamp:Date.now()-60000};
      for(const asset of ['eth','0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'])worker.onmessage({data:{type:'balance',run,asset,amount:'0',block}});
      worker.onmessage({data:{type:'done',run}});
    });
    await page.getByRole('button',{name:'Refresh '+a,exact:true}).click();
    expect(await page.evaluate(()=>(window as any).__verifiers.at(-1).request.rpcHost)).toBe('history.example');
    await page.evaluate(()=>{const worker=(window as any).__verifiers.at(-1);worker.onmessage({data:{type:'fatal',run:worker.request.id,error:'Test cleanup'}});});
  } else {
    await expect(page.locator('.wallet .spinner')).toHaveCount(0);
    await page.getByRole('button',{name:'Explain ETH failure for '+a,exact:true}).click();
    await expect(page.getByRole('region',{name:'ETH balance failure',exact:true})).toContainText('RPC cannot prove this finalized block');
    await expect(page.getByRole('region',{name:'ETH balance failure',exact:true}).locator('.failure-action')).toContainText('historical eth_getProof support');
  }
});

for (const width of [1280, 390]) test(`balance updates keep mounted rows, icons and column widths at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await stalledVerifier(page);
  await page.goto('/');
  await page.locator('#address').fill(a + '\n' + b);
  await page.getByRole('button', { name: 'add address to track', exact: true }).click();
  await expect(page.locator('.wallet-table > thead > tr > th')).toHaveCount(3);
  await expect(page.locator('.balances').first().locator(':scope > th, :scope > td')).toHaveCount(3);
  await expect(page.locator('.wallet-details > td').first()).toHaveAttribute('colspan', '3');
  await openWalletDetails(page, a);
  await page.locator('.retrieval-log > summary').first().click();
  await expect(page.locator('.log-stream li').first()).toHaveAttribute('data-log-id', /\d+/);
  await page.evaluate(() => {
    const nodes = ['.wallet-table', '.wallet', '.blockie', '.refresh-icon .spinner', '.balance .amount', '.total', '.detail-content', '.log-stream', '.log-stream li'];
    (window as any).__stableNodes = nodes.map(selector => ({ selector, node: document.querySelector(selector) }));
    (window as any).__panelHeight = document.querySelector('.verification-panel')!.getBoundingClientRect().height;
    (window as any).__columnWidths = [...document.querySelectorAll('.wallet-table > thead > tr > th')].map(node => node.getBoundingClientRect().width);
  });
  const block = { hash: '0x' + '11'.repeat(32), stateRoot: '0x' + '22'.repeat(32), number: '0x100', timestamp: Date.now() - 60_000 };
  const request = { requestId: 1, method: 'eth_getProof', host: 'rpc.example', state: 'waiting', startedAt: Date.now(), deadline: Date.now() + 90_000 };
  for (const event of [
    { type: 'network', request },
    { type: 'network', request: { ...request, requestId: 2 } },
    { type: 'network', request: { ...request, state: 'received' } },
    { type: 'network', request: { ...request, requestId: 2, state: 'received' } },
    { type: 'progress', stage: 'consensus', message: 'Checking finalized signatures.' },
    { type: 'progress', stage: 'balances-pricing', message: 'Checking private proofs and executing the token contract locally. '.repeat(8) },
    { type: 'balance', asset: 'eth', amount: '123456789123456789123456789', block },
    { type: 'asset-error', asset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', error: 'Private proof request failed' },
  ]) {
    await page.evaluate(event => {
      const worker = (window as any).__verifiers[0];
      worker.onmessage({ data: { ...event, run: worker.request.id } });
    }, event);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    expect(await page.evaluate(() => (window as any).__stableNodes.filter(({selector, node}: any) => document.querySelector(selector) !== node).map(({selector}: any) => selector))).toEqual([]);
    const shifts = await page.evaluate(() => [...document.querySelectorAll('.wallet-table > thead > tr > th')].map((node, i) => Math.abs(node.getBoundingClientRect().width - (window as any).__columnWidths[i])));
    expect(Math.max(...shifts)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => Math.abs(document.querySelector('.verification-panel')!.getBoundingClientRect().height - (window as any).__panelHeight))).toBeLessThanOrEqual(1);
  }
});

for (const width of [1280, 390]) test(`balance values and verification icons share one line at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await stalledVerifier(page);
  await page.goto('/');
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track', exact: true }).click();
  await expect(page.locator('.wallet .refresh-icon .spinner')).toHaveCount(1);
  await page.evaluate(() => {
    const worker = (window as any).__verifiers[0], run = worker.request.id;
    const block = { hash: '0x' + '11'.repeat(32), stateRoot: '0x' + '22'.repeat(32), number: '0x100', timestamp: Date.now() - 60_000 };
    worker.onmessage({data:{type:'balance', run, asset:'eth', amount:'130000000000000000', block}});
    worker.onmessage({data:{type:'price', run, asset:'eth', block, estimate:{pool:'0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',quote:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',symbol:'USDC',decimals:6,numerator:'2170690000',denominator:'1000000000000000000',window:1800,blockHash:block.hash,minLiquidity:'10000'}}});
  });
  const balance = page.locator('.balance').first();
  await expect(balance.locator('.amount')).toHaveText('0.13');
  await expect(balance.locator('.price-estimate')).toHaveText('≈ 282.19 USDC');
  await expect(balance.locator('.balance-values > .balance-status')).toHaveCount(1);
  await expect(balance.locator('.status-verified')).toHaveAttribute('title', 'Verified finalized');
  const geometry = await balance.evaluate(node => {
    const parts = ['.amount', '.price-estimate', '.balance-status'].map(selector => node.querySelector(selector)!.getBoundingClientRect());
    return { centers: parts.map(rect => rect.top + rect.height / 2), overlap: parts.some((rect, i) => i > 0 && rect.left < parts[i - 1].right), right: parts[2].right, cellRight: node.getBoundingClientRect().right };
  });
  expect(Math.max(...geometry.centers) - Math.min(...geometry.centers)).toBeLessThanOrEqual(1);
  expect(geometry.overlap).toBe(false);
  expect(geometry.right).toBeLessThanOrEqual(geometry.cellRight);
});

for (const width of [1280, 390]) test(`add-address plus button sits below tracked rows and toggles the form at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await mockConnection(page);
  await page.goto('/');
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track', exact: true }).click();
  const toggle = page.getByRole('button', { name: 'Add addresses', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle.locator('svg')).toBeVisible();
  await expect(toggle).toHaveText('');
  await expect(page.locator('#wallet-form')).not.toBeVisible();
  const below = await page.evaluate(() => document.querySelector('#address-panel')!.getBoundingClientRect().top >= document.querySelector('#wallets')!.getBoundingClientRect().bottom);
  expect(below).toBe(true);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#address')).toBeFocused();
  await page.locator('#address').fill('not an address');
  await page.getByRole('button', { name: 'add address to track', exact: true }).click();
  await expect(page.locator('#input-error')).not.toBeEmpty();
  await expect(page.locator('.wallet')).toHaveCount(1);
  await page.locator('#address-name').fill('Savings');
  await page.locator('#address').fill(b);
  await page.getByRole('button', { name: 'add address to track', exact: true }).click();
  await expect(page.locator('.wallet')).toHaveCount(2);
  await expect(page.locator('.wallet-head .address-name')).toHaveText('Savings');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.press('Enter');
  await expect(page.locator('#wallet-form')).toBeVisible();
  await toggle.press('Space');
  await expect(page.locator('#wallet-form')).not.toBeVisible();
  await page.reload();
  await expect(page.locator('.wallet')).toHaveCount(2);
  await expect(page.locator('#wallet-form')).not.toBeVisible();
});

for (const width of [1280, 390]) test(`connection header stays concise through Tor diagnostics at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.route('**/src/connection.ts*', route => route.fulfill({contentType:'text/javascript',body:`
    export class Connection {
      constructor(onState, onProgress) { this.onState=onState;this.onProgress=onProgress;window.__connection=this; }
      get() {
        this.onState('starting');
        this.onProgress('Tor worker: [00.095] [tor_memquota::config] Unable to get the total available memory. Using a constant max instead.');
        return new Promise(resolve=>{window.__ready=()=>{this.onState('ready');resolve({fetch:()=>Promise.reject(new Error('Unused'))});};});
      }
      close() {}
    }
  `}));
  await page.goto('/');
  const header=page.locator('#connection');
  await expect(header.locator('strong')).toHaveText('Starting private connection…');
  const before=await header.boundingBox();
  await page.locator('#address').fill(a);
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await openWalletDetails(page,a);
  await page.locator('.retrieval-log > summary').first().click();
  await expect(page.locator('.log-stream')).toContainText('Unable to get the total available memory');
  await page.evaluate(()=>(window as any).__connection.onProgress('Tor worker: '+ 'A long startup diagnostic. '.repeat(30)));
  await expect(header.locator('strong')).toHaveText('Starting private connection…');
  expect((await header.boundingBox())!.height).toBe(before!.height);
  await expect(header.locator('.spinner')).toHaveCount(1);
  await page.evaluate(()=>(window as any).__ready());
  await expect(header).toHaveText('Private worker ready');
  await expect(header.locator('.spinner')).toHaveCount(0);
});

test('slow Tor bootstrap survives its notice, times out with diagnostics and ignores late readiness', async ({page}) => {
  await page.clock.install();
  const direct: string[]=[];
  page.on('request',request=>{if(/^https?:/.test(request.url())&&!request.url().startsWith('http://127.0.0.1:5173'))direct.push(request.url());});
  await page.route('https://**/*',route=>route.abort('failed'));
  await page.route('**/node_modules/.vite/deps/@anon-rpc_browser-harness.js*',route=>route.fulfill({contentType:'text/javascript',body:`
    window.__torWorkers=[];
    export class AnonRpcWorker {
      constructor() {
        window.__torWorkers.push(this);this.closed=false;
        this.logs=[{level:'warn',args:['[01:52.583] Could not connect to guard [scrubbed]. Retrying in 2m 30s.']},{level:'warn',args:['[01:57.599] Could not connect to guard [scrubbed]. Retrying in 2m 30s.']}];
        this.ready=new Promise(resolve=>{this.resolve=resolve;});
      }
      acceptLog(){return this.logs.length?Promise.resolve(this.logs.shift()):new Promise(()=>{});}
      close(){this.closed=true;}
      fetch(_,init){const body=JSON.parse(init.body);return Promise.resolve(Response.json({jsonrpc:'2.0',id:body.id,result:'0x'+'0'.repeat(64)}));}
    }
  `}));
  await page.goto('/');
  await expect(page.getByText('Ethereum balances · saved on this browser',{exact:true})).toHaveCount(0);
  await page.locator('#address').fill(a);
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await expect(page.locator('#connection strong')).toContainText('Connecting to a Tor guard');
  await expect.poll(()=>page.evaluate(()=>(window as any).__torWorkers.length)).toBe(1);
  await page.clock.fastForward(30_001);
  await expect(page.locator('#connection strong')).toContainText('Taking longer than usual');
  expect(await page.evaluate(()=>(window as any).__torWorkers[0].closed)).toBe(false);
  await page.clock.fastForward(270_000);
  await expect(page.locator('#connection')).toContainText('Private connection unavailable');
  expect(await page.evaluate(()=>(window as any).__torWorkers.length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).__torWorkers[0].closed)).toBe(true);
  await openWalletDetails(page,a);
  await page.locator('.retrieval-log > summary').click();
  const lines=await page.locator('.log-stream li > span').allTextContents();
  expect(lines.some(line=>line.includes('[01:52.583]'))).toBe(true);
  expect(lines.some(line=>line.includes('[01:57.599]'))).toBe(true);
  expect(lines.every(line=>!(line.includes('[01:52.583]')&&line.includes('[01:57.599]')))).toBe(true);
  await page.clock.fastForward(2000);
  await expect.poll(()=>page.evaluate(()=>(window as any).__torWorkers.length)).toBe(2);
  await expect(page.locator('#connection strong')).toContainText('Connecting to a Tor guard');
  await page.evaluate(()=>(window as any).__torWorkers[0].resolve());
  await expect(page.locator('#connection strong')).toContainText('Connecting to a Tor guard');
  await page.evaluate(()=>(window as any).__torWorkers[1].resolve());
  await expect(page.locator('#connection')).toHaveText('Private worker ready');
  expect(direct).toEqual([]);
});


test('shared startup status appears only in the header, with both address details open', async ({page}) => {
  await mockConnection(page,true);
  await page.goto('/');
  await page.locator('#address').fill(a+'\n'+b);
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await openWalletDetails(page,a);
  await openWalletDetails(page,b);
  await expect(page.locator('#connection strong')).toHaveText('Starting private connection…');
  await expect(page.locator('.compact-progress')).toHaveText(['','']);
  for (const detail of await page.locator('.detail-content').all()) {
    await expect(detail).not.toContainText('Starting private connection');
    await expect(detail).not.toContainText('Loading bundled Tor worker');
  }
  await expect(page.locator('.verification-stages')).toHaveText(['VerifierConsensusBalancesPrices','VerifierConsensusBalancesPrices']);
  for (const activity of await page.locator('.activity').all()) await expect(activity).not.toContainText('private connection');
  await expect(page.locator('footer')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__calls.length)).toBe(0);
});

test('expanded request details replace the compact preview and retain the historical log', async ({page}) => {
  await stalledVerifier(page);
  await page.goto('/');
  await page.locator('#address').fill(a);
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__verifiers?.length)).toBe(1);
  await page.evaluate(()=>{
    const worker=(window as any).__verifiers[0];
    worker.onmessage({data:{type:'progress',run:worker.request.id,stage:'consensus',message:'Checking signed finalized headers.'}});
    worker.onmessage({data:{type:'network',run:worker.request.id,request:{requestId:1,method:'eth_getProof',host:'rpc.example',state:'waiting',startedAt:Date.now(),deadline:Date.now()+90000}}});
  });
  await expect(page.locator('.compact-progress')).toContainText('eth_getProof · rpc.example');
  await openWalletDetails(page,a);
  await expect(page.locator('.compact-progress')).toBeEmpty();
  await expect(page.locator('.progress-request')).toHaveCount(1);
  await expect(page.locator('.progress-request')).toContainText('eth_getProof → rpc.example');
  await page.locator('.retrieval-log > summary').click();
  await expect(page.locator('.log-stream')).toContainText('Checking signed finalized headers.');
  await page.getByRole('button',{name:'Details '+a,exact:true}).click();
  await expect(page.locator('.compact-progress')).toContainText('eth_getProof · rpc.example');
});

test('a failed balance has one actionable warning instead of duplicate warning icons', async ({page}) => {
  await mockConnection(page,false,true);
  await page.goto('/');
  await page.locator('#address').fill(a);
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  const balance=page.locator('.balance').first();
  await expect(balance.locator('.status-unavailable')).toHaveCount(1);
  await expect(balance.locator('.balance-status [role="img"]')).toHaveCount(1);
  await balance.locator('.failure-link').click();
  await expect(page.locator('.failure-details')).toHaveAttribute('open','');
  await expect(page.locator('.read-failure').first()).toContainText('private connection unavailable');
});


for (const [target, fail] of [[a,false],[b,false],[b,true]] as const) {
  test(`refresh affects only ${target === a ? 'first' : 'second'} address on ${fail ? 'failure' : 'success'}`,async ({page}) => {
    await mockConnection(page);
    const publicRequests: string[]=[];
    page.on('request',request=>{if(request.method()==='POST')publicRequests.push(request.url());});
    await page.goto('/');
    await page.locator('#address').fill(a+'\n'+b);
    await page.getByRole('button',{name:'add address to track',exact:true}).click();
    await expect(page.locator('.amount')).toHaveText(['1','1']);
    await expect(page.locator('.wallet[data-loading="true"]')).toHaveCount(0);
    const other=target===a?b:a;
    await openWalletDetails(page,other);
    const untouched=page.locator('.wallet[data-address="'+other+'"]');
    const selected=page.locator('.wallet[data-address="'+target+'"]');
    const otherHTML=await untouched.innerHTML();
    const savedOther=await page.evaluate(address=>JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).wallets.find((wallet:any)=>wallet.address===address),other);
    const previousCalls=await page.evaluate(()=>(window as any).__calls);
    const originalKey=previousCalls.find((call:any)=>call.body.method==='eth_getBalance'&&call.body.params[0]===target).key;
    await page.evaluate(fail=>{(window as any).__delay=1000;(window as any).__ethBalance='0x1bc16d674ec80000';(window as any).__fail=fail;},fail);
    await page.getByRole('button',{name:'Refresh '+target,exact:true}).click();
    await expect(selected).toHaveAttribute('data-loading','true');
    await expect(selected.locator('.refresh-icon .spinner')).toBeVisible();
    await expect(untouched).toHaveAttribute('data-loading','false');
    await expect(untouched.locator('.spinner')).toHaveCount(0);
    await expect(page.locator('.total .spinner')).toHaveCount(0);
    await expect(page.locator('.total-status')).toHaveCount(0);
    await expect(page.locator('.total-amount')).toHaveText(['2','0']);
    expect(await untouched.innerHTML()).toBe(otherHTML);
    await expect(page.getByRole('button',{name:'Refresh '+target,exact:true})).toBeEnabled({timeout:10000});
    const newCalls=await page.evaluate(count=>(window as any).__calls.slice(count),previousCalls.length);
    expect(newCalls).toHaveLength(fail?4:2);
    expect(newCalls.every((call:any)=>call.key===originalKey)).toBe(true);
    expect(newCalls.every((call:any)=>call.body.method==='eth_getBalance'?call.body.params[0]===target:call.body.params[0].data.endsWith(target.slice(2)))).toBe(true);
    expect(await untouched.innerHTML()).toBe(otherHTML);
    expect(await page.evaluate(address=>JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).wallets.find((wallet:any)=>wallet.address===address),other)).toEqual(savedOther);
    await expect(page.locator('.total-amount')).toHaveText([fail?'2':'3','0']);
    expect(publicRequests).toEqual([]);
  });
}


test('short request purposes and honest check counts stay accurate during parallel proof work',async({page})=>{
  await stalledVerifier(page);await page.goto('/');
  await page.locator('#address').fill(a);
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await openWalletDetails(page,a);
  const block={hash:'0x'+'11'.repeat(32),stateRoot:'0x'+'22'.repeat(32),number:'0x100',timestamp:Date.now()-60000};
  const weth='0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  async function emit(event:object){await page.evaluate(event=>{const w=(window as any).__verifiers[0];w.onmessage({data:{...event,run:w.request.id}});},event);}
  await emit({type:'price-error',asset:'eth',error:'No quote'});
  await emit({type:'balance',asset:'eth',amount:'0',block});
  await emit({type:'progress',stage:'balances-pricing',message:'Checking independent balance and price reads.'});
  const startedAt=Date.now(),request={requestId:1,method:'eth_getProof',host:'rpc.example',purpose:'WETH storage proof · 2 slots',target:weth,state:'waiting',startedAt,deadline:startedAt+90000};
  await emit({type:'network',request});
  await expect(page.locator('.progress-heading')).toContainText('2/4 checks');
  await expect(page.locator('.progress-request p')).toContainText('WETH storage proof · 2 slots');
  await expect(page.locator('.progress-request p')).not.toContainText('eth_getProof');
  await expect(page.locator('.progress-request p')).toHaveAttribute('title',new RegExp('eth_getProof.*'+weth));
  await expect(page.locator('.compact-progress')).toBeEmpty();
  await page.locator('.retrieval-log > summary').click();
  await expect(page.locator('.log-stream')).toContainText('2/4 checks · WETH storage proof · 2 slots · requested');
  const height=await page.locator('.verification-panel').evaluate(node=>node.getBoundingClientRect().height);
  await emit({type:'network',request:{...request,requestId:2,method:'eth_getCode',purpose:'WETH/USDC pool bytecode'}});
  await expect(page.locator('.progress-request p')).toHaveText(['WETH storage proof · 2 slots → rpc.example','WETH/USDC pool bytecode → rpc.example']);
  await expect(page.locator('.progress-heading')).toContainText('2/4 checks');
  await emit({type:'price-error',asset:'eth',error:'Duplicate event'});
  await expect(page.locator('.progress-heading')).toContainText('2/4 checks');
  await page.getByRole('button',{name:'Details '+a,exact:true}).click();
  await expect(page.locator('.compact-progress')).toContainText('2/4 checks · WETH storage proof');
  await expect(page.locator('.compact-progress')).toHaveAttribute('title',new RegExp('WETH storage proof.*eth_getProof.*'+weth));
  await openWalletDetails(page,a);
  await emit({type:'balance',asset:weth,amount:'0',block});
  await emit({type:'price-error',asset:weth,error:'No pool'});
  await expect(page.locator('.progress-heading')).toContainText('4/4 checks');
  expect(await page.locator('.verification-panel').evaluate(node=>node.getBoundingClientRect().height)).toBe(height);
});

for (const width of [1280, 768, 390, 320]) test(`large balances and estimated values remain complete at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await stalledVerifier(page);
  await page.goto('/');
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track', exact: true }).click();
  await page.evaluate(() => {
    const worker = (window as any).__verifiers[0], run = worker.request.id;
    const block = { hash: '0x'+'11'.repeat(32), stateRoot: '0x'+'22'.repeat(32), number: '0x100', timestamp: Date.now()-60_000 };
    for (const asset of ['eth', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2']) {
      worker.onmessage({data:{type:'balance',run,asset,amount:'7012610000000000000000',block}});
      worker.onmessage({data:{type:'price',run,asset,block,estimate:{pool:'0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',quote:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',symbol:'USDC',decimals:6,numerator:'15637500690000',denominator:'7012610000000000000000',window:1800,blockHash:block.hash,minLiquidity:'10000'}}});
    }
  });
  await expect(page.locator('.balance .amount').first()).toHaveText('7012.61');
  await expect(page.locator('.balance .price-value').first()).toHaveText('≈ 15637500.69 USDC');
  await expect(page.locator('.total .token-value-amount').first()).toHaveText('≈ 15637500.69 USDC');
  await expect(page.locator('.portfolio-value-number')).toHaveText('≈ 31275001.38');
  const clipped = await page.locator('.amount, .price-value, .total-amount, .token-value-amount, .portfolio-value-number').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1).map(node => ({className:node.className,text:node.textContent})));
  expect(clipped).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // A complete balance column must be reachable, without the sticky address
  // covering its leading digits when the portfolio scrolls horizontally.
  const visible = await page.locator('.balance').last().evaluate(cell => {
    cell.scrollIntoView({block:'nearest',inline:'end'});
    const rect = cell.getBoundingClientRect(), root = document.querySelector('#wallets')!.getBoundingClientRect();
    return rect.left >= root.left && rect.right <= root.right;
  });
  expect(visible).toBe(true);
  if (width === 1280 || width === 390) await page.screenshot({path:'test-results/large-balances-'+width+'.png',fullPage:true});
  // Even unusually large uint256 balances and price ratios must wrap instead
  // of silently dropping digits, without overflowing the page or token cell.
  await page.evaluate(() => {
    const worker = (window as any).__verifiers[0], run = worker.request.id;
    const block = { hash: '0x'+'11'.repeat(32), stateRoot: '0x'+'22'.repeat(32), number: '0x100', timestamp: Date.now()-60_000 };
    worker.onmessage({data:{type:'balance',run,asset:'eth',amount:(2n**256n-1n).toString(),block}});
    worker.onmessage({data:{type:'price',run,asset:'eth',block,estimate:{pool:'0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',quote:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',symbol:'USDC',decimals:6,numerator:'1000000000000000000000000',denominator:'1',window:1800,blockHash:block.hash,minLiquidity:'10000'}}});
  });
  await expect(page.locator('.balance .amount').first()).toContainText('115792089237316195423570985008687907853269984665640564039457.58');
  expect(await page.locator('.amount, .price-value, .total-amount, .token-value-amount, .portfolio-value-number').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1).map(node => node.className))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const width of [1280, 390]) test(`sparse holdings omit proven zeroes without a disclosure at ${width}px`, async ({ page }) => {
  await page.setViewportSize({width,height:844});
  await stalledVerifier(page);
  await page.addInitScript(() => {
    const tokens = [{address:'eth',symbol:'ETH',decimals:18},{address:'0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',symbol:'WETH',decimals:18},
      ...Array.from({length:10},(_,i)=>({address:'0x'+(256+i).toString(16).padStart(40,'0'),symbol:'T'+i,decimals:18}))];
    localStorage.setItem('anonfolio.portfolio.v2',JSON.stringify({version:3,tokens,wallets:[]}));
  });
  await page.goto('/');
  await page.locator('#address').fill(a+'\n'+b);
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  const first=page.locator('.wallet').first();
  // Unknown tokens stay visible while the first verified reads are outstanding.
  await expect(first.locator('.holdings-content > .holdings-list > .balance:visible')).toHaveCount(12);
  const complete = async (done:boolean) => page.evaluate(done => {
    const worker=(window as any).__verifiers[0],run=worker.request.id;
    const block={hash:'0x'+'11'.repeat(32),stateRoot:'0x'+'22'.repeat(32),number:'0x100',timestamp:Date.now()-60000};
    for(const [i,token] of worker.request.tokens.entries()) {
      if(i===11) {worker.onmessage({data:{type:'asset-error',run,asset:token.address,error:'Private proof unavailable'}});continue;}
      worker.onmessage({data:{type:'balance',run,asset:token.address,amount:i===(worker.request.address.endsWith('1')?0:2)?'7000000000000000000':'0',block}});
      worker.onmessage({data:{type:'price',run,asset:token.address,block,estimate:{pool:'0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',quote:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',symbol:'USDC',decimals:6,numerator:'2000000000',denominator:'1000000000000000000',window:1800,blockHash:block.hash,minLiquidity:'10000'}}});
    }
    if(done)worker.onmessage({data:{type:'done',run}});
  },done);
  await complete(false);
  await expect(first.locator('.holdings-content > .holdings-list > .balance:visible')).toHaveCount(2);
  await expect(first.locator('.address-valuation')).toContainText('≈ 14000 USDC');
  await expect(first.locator('.zero-holdings')).toHaveCount(0);
  await expect(first).not.toContainText('zero-balance token');
  const weth=first.locator('.balance[data-asset="0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"]');
  await expect(weth).toHaveCount(0);
  await page.evaluate(() => {
    const worker=(window as any).__verifiers[0],run=worker.request.id;
    worker.onmessage({data:{type:'asset-error',run,asset:'0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',error:'Private route unavailable'}});
  });
  await expect(first.locator('.holdings-content > .holdings-list > .balance:visible')).toHaveCount(3);
  await expect(weth).toBeVisible();
  await complete(true);
  await expect(weth).toHaveCount(0);
  await complete(true);
  const second=page.locator('.wallet').nth(1);
  await expect(second.locator('.holdings-content > .holdings-list > .balance:visible')).toHaveCount(2);
  await expect(second.locator('.holdings-content > .holdings-list .token').first()).toHaveAttribute('title','0x0000000000000000000000000000000000000100');
  await expect(first.locator('.holdings-content > .holdings-list .token').first()).toHaveAttribute('title','Native Ethereum');
  expect(await page.locator('#wallets').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/sparse-holdings-'+width+'.png',fullPage:true});
});

test('reopening saved addresses never refreshes until requested, including history return', async ({ page }) => {
  await mockConnection(page);
  await page.goto('/');
  await page.locator('#address').fill(a + '\n' + b);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.amount')).toHaveText(['1', '1']);
  const saved = await page.evaluate(() => localStorage.getItem('anonfolio.portfolio.v2'));
  await page.reload();
  await expect(page.locator('.balance small.cached')).toHaveCount(4);
  await page.clock.install();
  await page.clock.runFor(65_000);
  expect(await page.evaluate(() => (window as any).__calls)).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('anonfolio.portfolio.v2'))).toBe(saved);
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await page.clock.runFor(1000);
  await expect(page.locator('.wallet').first().locator('.balance small.cached')).toHaveCount(0);
  await expect(page.locator('.wallet').nth(1).locator('.balance small.cached')).toHaveCount(2);
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls).toHaveLength(2);
  expect(calls.every((call: any) => JSON.stringify(call.body).toLowerCase().includes(a.slice(2).toLowerCase()))).toBe(true);
  // A failed user-initiated refresh retries while active, but leaving cancels it.
  await page.evaluate(() => { (window as any).__fail = true; });
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await page.clock.runFor(2000);
  await expect(page.locator('.wallet').first().locator('.error')).toHaveCount(2);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new Event('online'));
    (window as any).__calls = [];
  });
  await page.clock.runFor(65_000);
  expect(await page.evaluate(() => (window as any).__calls)).toEqual([]);
  await expect(page.locator('.wallet .spinner')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.wallet').first().locator('.error')).toHaveCount(2);
  await page.clock.runFor(65_000);
  expect(await page.evaluate(() => (window as any).__calls)).toEqual([]);
});
