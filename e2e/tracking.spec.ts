import { encodeAbiParameters, keccak256, stringToBytes } from 'viem';
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
  await expect(page.locator('#connection')).toContainText('bundled Tor worker');
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
  await expect(page.locator('.activity').first()).toContainText('eth.drpc.org');
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
  page.once('dialog', dialog => dialog.accept());
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
  page.once('dialog', dialog => dialog.accept());
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
          return Response.json({ jsonrpc: '2.0', id: body.id, result: body.method === 'eth_getBalance' ? '0xde0b6b3a7640000' : '0x' + '0'.repeat(64) });
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
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
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
  await expect(page.locator('.activity-item .address-display')).toHaveCount(0);
  await expect(page.locator('.activity')).not.toContainText(a);
  await expect(page.locator('.detail-inner')).not.toContainText('Private RPC operator:');
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
  await expect(page.locator('header #connection')).toBeVisible();
  await expect(page.locator('main #connection')).toHaveCount(0);
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


test('address removal requires confirmation and cancellation preserves saved balances', async ({ page }) => {
  await mockConnection(page);
  await page.goto('/');
  await page.getByLabel('Address name', { exact: false }).fill('Savings');
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
  const saved = await page.evaluate(() => localStorage.getItem('anonfolio.portfolio.v2'));
  const remove = page.getByRole('button', { name: 'Remove ' + a + ' · Savings', exact: true });
  const cancelled = page.waitForEvent('dialog');
  const cancelClick = remove.click();
  const prompt = await cancelled;
  expect(prompt.type()).toBe('confirm');
  expect(prompt.message()).toContain('Savings\n' + a);
  expect(prompt.message()).toContain('saved balances');
  await prompt.dismiss();
  await cancelClick;
  await expect(page.locator('.wallet')).toHaveCount(1);
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
  expect(await page.evaluate(() => localStorage.getItem('anonfolio.portfolio.v2'))).toBe(saved);
  await page.reload();
  await expect(page.locator('.wallet-head .address-name')).toHaveText('Savings');
  await expect(page.getByRole('button', { name: 'Refresh ' + a + ' · Savings', exact: true })).toBeEnabled();
  page.once('dialog', dialog => dialog.accept());
  await remove.click();
  await expect(page.locator('.wallet')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).wallets)).toEqual([]);
  await page.reload();
  await expect(page.locator('.wallet')).toHaveCount(0);
});


test('TWAP holding estimates, partial totals and custom quote settings persist', async ({ page }) => {
  await mockVerification(page, true);
  await mockConnection(page);
  await page.goto('/');
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'add address to track' }).click();
  await expect(page.locator('.price-estimate')).toHaveText(['≈ 2000 USDC', '≈ 0 USDC']);
  await expect(page.locator('.price-estimate').first()).toBeVisible();
  await expect(page.locator('#estimated-total')).toContainText('≈ 2000 USDC');
  await expect(page.locator('#estimated-total')).not.toContainText('Partial');
  await addToken(page);
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.locator('.price-estimate')).toHaveText(['≈ 2000 USDC', '≈ 0 USDC', 'Unpriced']);
  await expect(page.locator('#estimated-total')).toContainText('Partial · 2/3 holdings priced');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Quote token', { exact: true }).selectOption('custom');
  await page.getByLabel('Quote contract address').fill('invalid');
  await page.getByLabel('Quote symbol').fill('CUSTOM');
  await page.getByLabel('Quote fallback decimals').fill('18');
  await page.getByRole('button', { name: 'Save pricing and refresh' }).click();
  await expect(page.locator('#pricing-error')).toContainText('valid mainnet');
  await page.getByLabel('Quote contract address').fill(b);
  await page.getByLabel('Minimum quote-side liquidity').fill('100');
  await page.getByRole('button', { name: 'Save pricing and refresh' }).click();
  await expect(page.locator('#estimated-total')).toContainText('— CUSTOM · Partial');
  await expect(page.locator('.price-estimate')).toHaveText(['Unpriced', 'Unpriced', 'Unpriced']);
  await page.reload();
  await expect(page.locator('#estimated-total')).toContainText('CUSTOM · Partial');
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
        if(window.__recovered) emit({type:'balance',asset:token.address,amount:token.address==='eth'?'1000000000000000000':'0',decimals:18,decimalsVerified:true,block});
        else emit({type:'asset-error',asset:token.address,error:token.address==='eth'?'Error: Private eth_getProof rejected (-32602): distance to target block exceeds maximum proof window. https://user:password@rpc.example/key-secret?token=query-secret':'Bytecode hash does not match the verified account.'});
      }
      emit({type:'progress',message:'Later progress must not erase earlier failures'});
    }
  ` }));
  await page.goto('/');
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
  await expect(page.locator('.balance small.error')).toHaveText(['Unverified saved value · verification failed', 'Unverified saved value · verification failed']);
  await expect(page.locator('.failure-link').first()).toHaveText('RPC proof history unavailable · Details');
  const ethFailure = page.getByRole('region', { name: 'ETH balance failure', exact: true });
  await expect(ethFailure).toBeHidden();
  await page.getByRole('button', { name: 'Explain ETH failure for ' + a, exact: true }).click();
  await expect(ethFailure).toBeVisible();
  await expect(ethFailure).toContainText('distance to target block exceeds maximum proof window');
  await expect(ethFailure).toContainText('supports account and storage proofs at finalized block hashes');
  await expect(ethFailure).toContainText('While: Fetching ETH proof at finalized block');
  await expect(page.getByRole('region', { name: 'WETH balance failure', exact: true })).toContainText('Bytecode hash does not match');
  const saved = await page.evaluate(() => localStorage.getItem('anonfolio.portfolio.v2')!);
  expect(saved).toContain('maximum proof window'); expect(saved).not.toMatch(/password|key-secret|query-secret/);
  await expect(page.locator('body')).not.toContainText('password');
  await ethFailure.getByRole('button', { name: 'Open network settings' }).click();
  await expect(page.getByLabel('Balance RPC endpoints', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.evaluate(() => { (window as any).__recovered = true; });
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(page.locator('.failure-link')).toHaveCount(0);
  await expect(page.locator('.read-failure')).toHaveCount(0);
  await expect(page.locator('.balance small.error')).toHaveCount(0);
});

test('an expired checkpoint links to checkpoint settings instead of suggesting an RPC change', async ({ page }) => {
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
  await report.getByRole('button', { name: 'Open network settings' }).click();
  await expect(page.locator('#settings-checkpoint-root')).toBeFocused();
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
  await expect(page.locator('#connection > summary')).toContainText('Gateway connection refused (ECONNREFUSED)');
  await expect(page.locator('#connection > summary')).toContainText('Tor bootstrap failed');
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
  await expect(page.locator('#connection > summary')).toContainText('Private worker ready');
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


test('manual PublicNode worker update is explicit, cached, applied on save and fails closed if corrupted', async ({ page }) => {
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
    const result = body.method === 'eth_blockNumber' ? '0x123' : body.id === 2 ? hash : encodeAbiParameters([{type:'string[]'}], [[resolver]]);
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
  await expect(page.locator('#connection > summary')).toContainText('Saved Tor worker digest mismatch');
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
