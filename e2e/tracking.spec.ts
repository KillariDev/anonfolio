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
  await page.locator('.token-settings summary').click();
  await page.getByLabel('Token contract address', { exact: true }).fill(usdc);
  await page.getByLabel('Symbol', { exact: true }).fill('USDC');
  await page.getByLabel('Decimals', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Add token', exact: true }).click();
}
test.beforeEach(async () => {
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
  await page.locator('#address').fill(a + ',\n' + b + '\n' + a);
  await page.getByRole('button', { name: 'Add wallet' }).click();
  await expect(page.locator('.wallet')).toHaveCount(2);
  await expect(page.locator('.wallet[data-loading="true"]')).toHaveCount(2);
  await expect(page.locator('.activity-item.waiting')).toHaveCount(6);
  await expect(page.locator('.activity').first()).toContainText('balance calls have not been submitted yet');
  expect(await page.evaluate(() => (window as any).__calls.length)).toBe(0);
  await page.evaluate(() => { (window as any).__delay = 1000; (window as any).__releaseConnection(); });
  await expect(page.locator('.activity-item.requesting')).toHaveCount(6);
  await expect(page.locator('.activity').first()).toContainText('eth_getBalance(address, latest)');
  await expect(page.locator('.activity').first()).toContainText(usdc);
  await expect(page.locator('.route').first()).toContainText('ethereum-rpc.publicnode.com');
  await expect(page.locator('.amount')).toHaveText(['1', '0', '1.234567', '1', '0', '1.234567']);
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
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'Add wallet' }).click();
  await expect(page.locator('.amount')).toHaveText(['1', '0', '1.234567']);
  const originalTimes = await page.locator('.balance time').evaluateAll(nodes => nodes.map(node => node.getAttribute('datetime')));
  const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!));
  expect(snapshot.tokens[0].decimals).toBe(6);
  expect(snapshot.wallets[0].eth.amount).toBe('1000000000000000000');
  expect(JSON.stringify(snapshot)).not.toContain('isolationKey');
  await page.evaluate(() => { (window as any).__fail = true; });
  await page.getByRole('button', { name: 'Refresh ' + a, exact: true }).click();
  await expect(page.locator('.error')).toHaveCount(3);
  await expect(page.locator('.amount')).toHaveText(['1', '0', '1.234567']);
  expect(await page.locator('.balance time').evaluateAll(nodes => nodes.map(node => node.getAttribute('datetime')))).toEqual(originalTimes);
  await page.unroute('**/src/connection.ts*');
  await mockConnection(page, false, true);
  await page.reload();
  await expect(page.locator('.amount')).toHaveText(['1', '0', '1.234567']);
  await expect(page.locator('.error')).toHaveCount(3);
  expect(await page.locator('.balance time').evaluateAll(nodes => nodes.map(node => node.getAttribute('datetime')))).toEqual(originalTimes);
  await page.locator('.token-settings summary').click();
  await page.getByRole('button', { name: 'Remove token USDC' }).click();
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
  await page.reload();
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
});

test('invalid bulk input is atomic and invalid or duplicate tokens do not change settings', async ({ page }) => {
  await mockConnection(page);
  await page.goto('/');
  await page.locator('#address').fill(a + '\ninvalid');
  await page.getByRole('button', { name: 'Add wallet' }).click();
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
  await page.locator('#address').fill(a);
  await page.getByRole('button', { name: 'Add wallet' }).click();
  await expect(page.locator('.amount')).toHaveText(['1', '0']);
  await expect(page.locator('#storage-warning')).toContainText('could not be saved');
});
