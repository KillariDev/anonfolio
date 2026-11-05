import { openAddressForm, openTokenSettings, mockVerification } from './helpers';
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
        this.onProgress?.('Public discovery: requesting worker contract from bootstrap.example. No watched address is sent.');
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
              result: body.method === 'eth_getBalance' ? '0xde0b6b3a7640000' : '0x' + (custom ? 1234567n : 0n).toString(16).padStart(64, '0') });
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
  await expect(page.locator('#connection')).toContainText('bootstrap.example');
  await addToken(page);
  await openAddressForm(page);
  await page.locator('#address').fill(a + ',\n' + b + '\n' + a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.wallet')).toHaveCount(2);
  await expect(page.locator('.wallet[data-loading="true"]')).toHaveCount(2);
  await expect(page.locator('.activity-item.waiting')).toHaveCount(6);
  await expect(page.locator('.activity').first()).toContainText('balance calls have not been submitted yet');
  expect(await page.evaluate(() => (window as any).__calls.length)).toBe(0);
  await page.evaluate(() => { (window as any).__delay = 1000; (window as any).__releaseConnection(); });
  await expect(page.locator('.activity-item.requesting')).toHaveCount(6);
  await expect(page.locator('.activity').first()).toContainText('eth_getProof(address)');
  await expect(page.locator('.activity').first()).toContainText(usdc);
  await expect(page.locator('.route').first()).toContainText('ethereum-rpc.publicnode.com');
  await expect(page.locator('.amount')).toHaveText(['1', '0', '1.23', '1', '0', '1.23']);
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
  await expect(page.locator('.amount')).toHaveText(['1', '0', '1.23']);
  const originalTimes = await page.locator('.balance time').evaluateAll(nodes => nodes.map(node => node.getAttribute('datetime')));
  const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!));
  expect(snapshot.tokens.find((token: any) => token.address === usdc).decimals).toBe(6);
  expect(snapshot.wallets[0].balances.eth.amount).toBe('1000000000000000000');
  expect(JSON.stringify(snapshot)).not.toContain('isolationKey');
  await page.evaluate(() => { (window as any).__fail = true; });
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(page.locator('.error')).toHaveCount(3);
  await expect(page.locator('.amount')).toHaveText(['1', '0', '1.23']);
  expect(await page.locator('.balance time').evaluateAll(nodes => nodes.map(node => node.getAttribute('datetime')))).toEqual(originalTimes);
  await page.unroute('**/src/connection.ts*');
  await mockConnection(page, false, true);
  await page.reload();
  await expect(page.locator('.amount')).toHaveText(['1', '0', '1.23']);
  await expect(page.locator('.error')).toHaveCount(3);
  expect(await page.locator('.balance time').evaluateAll(nodes => nodes.map(node => node.getAttribute('datetime')))).toEqual(originalTimes);
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
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
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
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
  const originalCalls = await page.evaluate(() => (window as any).__calls);
  await page.evaluate(() => { (window as any).__fail = true; });
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(page.locator('.error')).toHaveCount(2);
  await expect(page.locator('.activity')).toContainText('Automatic retry 1 scheduled');
  await page.evaluate(() => { (window as any).__fail = false; });
  await expect(page.locator('.error')).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
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
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
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
  await page.getByRole('button', { name: 'Remove ' + a, exact: true }).click();
  const removedCount = await page.evaluate(() => (window as any).__calls.length);
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() => (window as any).__calls.length)).toBe(removedCount);
  await expect(page.locator('.wallet')).toHaveCount(0);
});

test('worker discovery failures reconnect automatically and resume pending reads', async ({ page }) => {
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
  await expect(page.locator('#connection')).toContainText('Automatic retry');
  await page.evaluate(() => { (window as any).__recover = true; });
  await expect(page.locator('#connection')).toContainText('Private worker ready', { timeout: 8000 });
  await expect(page.locator('.amount')).toHaveText(['0', '0'], { timeout: 8000 });
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
  await expect(page.locator('.total-status')).toHaveText(['10/10 addresses', '10/10 addresses', '10/10 addresses']);
  await expect(page.locator('.wallet-details:visible')).toHaveCount(0);
  await expect(page.locator('#address')).not.toBeVisible();
  const table = await page.locator('.wallet-table').boundingBox();
  expect(table!.height).toBeLessThan(600);
  expect(table!.y + table!.height).toBeLessThan(1000);
  await page.getByRole('button', { name: 'Details ' + a, exact: true }).click();
  await expect(page.locator('.wallet').first().locator('.full-address')).toBeVisible();
  await expect(page.locator('.wallet').first().locator('.activity')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh ' + a, exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Details ' + a, exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Details ' + a, exact: true }).click();
  await page.screenshot({ path: 'test-results/compact-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Remove ' + a, exact: true }).click();
  await expect(page.locator('.total-amount')).toHaveText(['9', '0', '11.11']);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#wallets')).toBeVisible();
  await page.locator('#wallets').evaluate(node => { node.scrollLeft = 300; });
  await page.getByRole('button', { name: 'Refresh ' + b, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh ' + b, exact: true })).toBeEnabled();
  expect(await page.locator('#wallets').evaluate(node => node.scrollLeft)).toBeGreaterThan(200);
  const left = await page.locator('.wallet-head .address-display').first().boundingBox();
  expect(left!.x).toBeLessThan(35);
  await page.locator('#wallets').evaluate(node => { node.scrollLeft = 0; });
  await page.screenshot({ path: 'test-results/compact-mobile.png', fullPage: true });
});

test('overview flags partial and stale totals while preserving known values during failure', async ({ page }) => {
  await mockConnection(page, true);
  await page.goto('/');
  await openAddressForm(page);
  await page.locator('#address').fill(a + '\n' + b);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.total-amount')).toHaveText(['—', '—']);
  await expect(page.locator('.total-status').first()).toContainText('Partial · 0/2 addresses');
  await page.evaluate(() => { (window as any).__releaseConnection(); });
  await expect(page.locator('.total-amount')).toHaveText(['2', '0']);
  await page.evaluate(() => { (window as any).__fail = true; });
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(page.locator('.total-status')).toHaveText(['2/2 addresses · 1 stale', '2/2 addresses · 1 stale']);
  await expect(page.locator('.total-amount')).toHaveText(['2', '0']);
  await page.evaluate(() => { (window as any).__fail = false; });
  await expect(page.locator('.total-status')).toHaveText(['2/2 addresses', '2/2 addresses'], { timeout: 8000 });
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
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
  await openTokenSettings(page);
  await page.getByRole('button', { name: 'Remove token ETH', exact: true }).click();
  await expect(page.locator('.total-label')).toHaveText(['WETH']);
  await page.reload();
  await expect(page.locator('.amount')).toHaveText(['0']);
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls.every((call: any) => call.body.method === 'eth_call')).toBe(true);
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
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
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
  await expect(page.locator('.amount')).toHaveText(['1', '0', '1', '0']);
  await expect(page.locator('.wallet[data-loading="true"]')).toHaveCount(0);
  await page.locator('#network-settings > summary').click();
  const originalGateway = await page.getByLabel('Tor gateways', { exact: true }).inputValue();
  const originalRpcs = await page.getByLabel('Balance RPC endpoints').inputValue();
  await page.getByLabel('Balance RPC endpoints').fill('http://unsafe.example');
  await page.getByRole('button', { name: 'Save settings and reconnect' }).click();
  await expect(page.locator('#settings-error')).toContainText('HTTPS');
  expect(await page.evaluate(() => localStorage.getItem('anonfolio.network.v1'))).toBeNull();
  await page.getByLabel('Balance RPC endpoints').fill('https://one.example/rpc\nhttps://two.example/rpc');
  await page.getByLabel('Public discovery RPC').fill('https://discovery.example/rpc');
  const customGateway = originalGateway.replace(':12298:', ':12299:');
  await page.getByLabel('Tor gateways', { exact: true }).fill(customGateway);
  // Pause the replacement worker to observe saved amounts during reconnect.
  await page.unroute('**/src/connection.ts*');
  await mockConnection(page, true);
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Save settings and reconnect' }).click()]);
  await expect(page.locator('.amount')).toHaveText(['1', '0', '1', '0']);
  await expect(page.locator('.balance small.cached')).toHaveCount(4);
  await expect(page.locator('#connection')).toContainText('152.236.3.22:12299');
  expect(await page.evaluate(() => (window as any).__calls)).toEqual([]);
  await page.locator('#network-settings > summary').click();
  await expect(page.getByLabel('Tor gateways', { exact: true })).toHaveValue(customGateway);
  await expect(page.getByLabel('Public discovery RPC')).toHaveValue('https://discovery.example/rpc');
  await page.evaluate(() => (window as any).__releaseConnection());
  await expect(page.locator('.wallet[data-loading="true"]')).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls).toHaveLength(4);
  expect(new Set(calls.map((call: any) => call.url))).toEqual(new Set(['https://one.example/rpc', 'https://two.example/rpc']));
  expect(new Set(calls.map((call: any) => call.key)).size).toBe(2);
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

test('saved gateways and discovery RPC reach the actual connection class; balance outage stays private', async ({ page }) => {
  const publicRequests: { url: string; body: any }[] = [];
  await page.route('https://**/*', async route => {
    publicRequests.push({ url: route.request().url(), body: route.request().postDataJSON() });
    await route.fulfill({ json: { jsonrpc: '2.0', id: route.request().postDataJSON().id, result: '0x00' } });
  });
  // Exercise the real Connection and viem transports, replacing only the worker.
  await page.route('**/node_modules/.vite/deps/@anon-rpc_browser-harness.js*', route => route.fulfill({
    contentType: 'text/javascript', body: `
      window.__calls = [];
      export class AnonRpcWorker {
        constructor(options) {
          window.__workerConfig = options.config;
          this.ready = options.preExisting.rpcProvider.request({ method: 'eth_getCode', params: [options.address, 'latest'] });
        }
        acceptLog() { return new Promise(() => {}); }
        close() {}
        async fetch(url, init) {
          const body = JSON.parse(init.body);
          window.__calls.push({ url, body, key: init.anonOptions.isolationKey });
          if (window.__fail) throw new Error('private route unavailable');
          return Response.json({ jsonrpc: '2.0', id: body.id, result: body.method === 'eth_getBalance' ? '0xde0b6b3a7640000' : '0x' + '0'.repeat(64) });
        }
      }
    `,
  }));
  await page.goto('/');
  await page.locator('#network-settings > summary').click();
  const gateway = (await page.getByLabel('Tor gateways', { exact: true }).inputValue()).replace(':12298:', ':12299:');
  await page.getByLabel('Tor gateways', { exact: true }).fill(gateway);
  await page.getByLabel('Public discovery RPC').fill('https://lookup.example/rpc');
  await page.getByLabel('Balance RPC endpoints').fill('https://private.example/rpc');
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Save settings and reconnect' }).click()]);
  await expect(page.locator('#connection')).toContainText('Private worker ready');
  expect(await page.evaluate(() => (window as any).__workerConfig)).toEqual({ gateways: [gateway] });
  expect(publicRequests.some(request => request.url === 'https://lookup.example/rpc')).toBe(true);
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
  await page.evaluate(() => { (window as any).__fail = true; });
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(page.locator('.balance small.error')).toHaveCount(2);
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls.length).toBeGreaterThanOrEqual(6);
  expect(calls.every((call: any) => call.url === 'https://private.example/rpc')).toBe(true);
  expect(new Set(calls.map((call: any) => call.key)).size).toBe(1);
  expect(publicRequests.every(request => request.body.method === 'eth_getCode'
    && request.body.params[0] === '0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e')).toBe(true);
  await page.locator('#network-settings > summary').click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/network-settings-mobile.png', fullPage: true });
});

test('named addresses use reusable blockies in rows and details, persist, and keep names out of RPC requests', async ({ page }) => {
  await mockConnection(page);
  const externalImages: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'image' && request.url().startsWith('https:')) externalImages.push(request.url()); });
  await page.goto('/');
  await page.getByLabel('Address name', { exact: false }).fill(' Savings ');
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
  const row = page.locator('.wallet-head .address-display');
  await expect(row.locator('.address-name')).toHaveText('Savings');
  await expect(row.locator('.wallet-address')).toHaveText(a);
  const blockie = await row.locator('svg').innerHTML();
  await expect(row.locator('svg rect')).toHaveCount(64);
  await page.getByRole('button', { name: 'Details ' + a + ' · Savings', exact: true }).click();
  const detail = page.locator('.full-address');
  await expect(detail.locator('.address-name')).toHaveText('Savings');
  await expect(detail.locator('.wallet-address')).toHaveText(a);
  expect(await detail.locator('svg').innerHTML()).toBe(blockie);
  await expect(page.locator('.activity-item .address-name')).toHaveText(['Savings', 'Savings']);
  expect(await page.evaluate(() => JSON.stringify((window as any).__calls))).not.toContain('Savings');
  await page.reload();
  await expect(page.locator('.wallet-head .address-name')).toHaveText('Savings');
  expect(await page.locator('.wallet-head svg').innerHTML()).toBe(blockie);
  await openAddressForm(page);
  await page.locator('#address').fill('Trading | ' + b + '\nUnnamed | 0x0000000000000000000000000000000000000003');
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.wallet-head .address-name')).toHaveText(['Savings', 'Trading', 'Unnamed']);
  expect(await page.locator('.wallet-head svg').nth(1).innerHTML()).not.toBe(blockie);
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
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
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
  expect(await address.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await settings.click();
  await expect(page.locator('#settings-panel')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/settings-popover-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.locator('#settings-panel')).not.toBeVisible();
  await page.screenshot({ path: 'test-results/header-mobile.png', fullPage: true });
});
