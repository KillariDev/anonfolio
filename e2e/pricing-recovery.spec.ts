import { expect, test, type Page } from '@playwright/test';
import { openAddressForm, openWalletDetails } from './helpers';

const address = '0x0000000000000000000000000000000000000001';
const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
async function fixture(page: Page, failure = '') {
  await page.route('**/src/connection.ts*', route => route.fulfill({ contentType: 'text/javascript', body: `
    window.__privateCalls=[];
    export class Connection {
      constructor(state){this.state=state;}
      get(){this.state('ready');return Promise.resolve({fetch:async(url,init)=>{
        window.__privateCalls.push({url,key:init.anonOptions.isolationKey,body:JSON.parse(init.body)});
        return Response.json({});
      }});}
      close(){}
    }
  ` }));
  await page.route('**/src/verification/client.ts*', route => route.fulfill({ contentType: 'text/javascript', body: `
    window.__runs=[];window.__failure=${JSON.stringify(failure)};window.__height=1;
    export async function verifyWallet(wallet,worker,tokens,emit,pricing,signal){
      const height=window.__height, failure=window.__failure, balanceFailure=window.__balanceFailure;
      window.__balanceFailure=false;
      window.__failure='';window.__runs.push({tokens:tokens.map(t=>t.address),pricing:structuredClone(pricing)});
      if(window.__hold) await new Promise(resolve=>window.__release=resolve);
      if(signal?.aborted)return;
      const block={hash:'0x'+height.toString(16).padStart(64,'0'),stateRoot:'0x'+'22'.repeat(32),number:'0x'+height.toString(16),timestamp:Date.now()-60000};
      for(const token of tokens){
        emit({type:'asset',asset:token.address});
        await worker.fetch(wallet.rpcUrl,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getProof',params:[wallet.address,[],{blockHash:block.hash}]}),anonOptions:{isolationKey:wallet.isolationKey}});
        if(balanceFailure && token.address===${JSON.stringify(weth)}){emit({type:'asset-error',asset:token.address,error:'Contract read failed'});continue;}
        emit({type:'balance',asset:token.address,amount:(BigInt(height)*10n**18n).toString(),block});
        if(token.address==='eth'&&failure)emit({type:'price-error',asset:token.address,error:failure});
        else emit({type:'price',asset:token.address,block,estimate:{pool:'0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',quote:pricing.quote.address,symbol:pricing.quote.symbol,decimals:pricing.quote.decimals,numerator:'1',denominator:'1',window:1800,blockHash:block.hash,minLiquidity:pricing.minLiquidity}});
      }
    }
  ` }));
}
async function add(page: Page) {
  await openAddressForm(page);
  await page.locator('#address').fill(address);
  await page.getByRole('button', { name: 'add address to track', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh ' + address, exact: true })).toBeEnabled();
}
async function setQuote(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#pricing-preset').selectOption('custom');
  await page.locator('#pricing-address').fill(weth);
  await page.locator('#pricing-symbol').fill('WETH');
  await page.locator('#pricing-decimals').fill('18');
  await page.locator('#pricing-liquidity').fill('10');
  await page.getByRole('button', { name: 'Save pricing and refresh', exact: true }).click();
}
test.beforeEach(() => test.skip(!!process.env.BASE_URL || !!process.env.IPFS_GATEWAY_URL, 'Development verifier boundary injection.'));

test('a transient price failure automatically retries only the affected holding on the same private route', async ({ page }) => {
  await page.clock.install(); await fixture(page, 'Private eth_getProof timed out after 90 seconds.');
  const publicRequests: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') publicRequests.push(request.url()); });
  await page.goto('/'); await add(page);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).wallets[0].balances.eth.priceFailure?.retryable)).toBe(true);
  await expect(page.locator('.wallet .spinner')).toHaveCount(0);
  await page.clock.runFor(3000);
  await expect.poll(() => page.evaluate(() => (window as any).__runs.length)).toBe(2);
  await expect(page.getByRole('button', { name: 'Refresh ' + address, exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__runs.map((run: any) => run.tokens))).toEqual([['eth', weth], ['eth']]);
  const calls = await page.evaluate(() => (window as any).__privateCalls);
  expect(calls).toHaveLength(3); expect(new Set(calls.map((call: any) => call.key)).size).toBe(1);
  expect(new Set(calls.map((call: any) => call.url)).size).toBe(1);
  expect(publicRequests).toEqual([]);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).wallets[0].balances.eth.priceError)).toBeUndefined();
  await page.clock.runFor(65000);
  expect(await page.evaluate(() => (window as any).__runs.length)).toBe(2);
});

test('permanent pricing failures survive reload with their details and never auto-refresh on return', async ({ page }) => {
  await page.clock.install(); await fixture(page, 'No direct pool qualifies: require 30-minute history.');
  await page.goto('/'); await add(page);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).wallets[0].balances.eth.priceError)).toContain('No direct pool qualifies');
  await page.clock.runFor(65000);
  expect(await page.evaluate(() => (window as any).__runs.length)).toBe(1);
  await page.reload(); await openWalletDetails(page, address);
  await page.locator('.failure-details > summary').click();
  await expect(page.locator('.read-failure[aria-label="ETH price failure"]')).toContainText('No qualifying direct pool');
  await page.clock.runFor(65000);
  expect(await page.evaluate(() => (window as any).__runs.length)).toBe(0);
  await page.evaluate(() => (window as any).__failure = '');
  await page.getByRole('button', { name: 'Refresh ' + address, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh ' + address, exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).wallets[0].balances.eth.priceError)).toBeUndefined();
});

test('quote settings synchronize between tabs without extra reads and the next refresh uses the displayed quote', async ({ page, context }) => {
  await fixture(page); await page.goto('/'); await add(page);
  const other = await context.newPage(); await fixture(other); await other.goto('/');
  await setQuote(other);
  await expect(page.locator('.portfolio-value-currency')).toHaveText('WETH');
  expect(await page.evaluate(() => (window as any).__runs.length)).toBe(1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#pricing-symbol')).toHaveValue('WETH');
  await expect(page.locator('#pricing-address')).toHaveValue(weth);
  await expect(page.locator('#pricing-decimals')).toHaveValue('18');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh ' + address, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh ' + address, exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__runs.at(-1).pricing.quote)).toEqual({ address: weth, symbol: 'WETH', decimals: 18, icon: 'builtin:weth' });
  await expect(page.locator('.wallet .price-estimate')).toHaveText(['≈ 1 WETH', '≈ 1 WETH']);
  await other.close();
});

test('a quote change during a refresh keeps its request snapshot and never displays the old currency estimate', async ({ page, context }) => {
  await fixture(page); await page.goto('/'); await add(page);
  const other = await context.newPage(); await fixture(other); await other.goto('/');
  await page.evaluate(() => (window as any).__hold = true);
  await page.getByRole('button', { name: 'Refresh ' + address, exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__release)).toBe('function');
  await setQuote(other);
  await expect(page.locator('.portfolio-value-currency')).toHaveText('WETH');
  await page.evaluate(() => { (window as any).__hold = false; (window as any).__release(); });
  await expect(page.getByRole('button', { name: 'Refresh ' + address, exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__runs.at(-1).pricing.quote.address)).toBe(usdc);
  await expect(page.locator('.wallet .price-estimate')).not.toContainText(['USDC', 'USDC']);
  await page.getByRole('button', { name: 'Refresh ' + address, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh ' + address, exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__runs.at(-1).pricing.quote.address)).toBe(weth);
  await expect(page.locator('.wallet .price-estimate')).toHaveText(['≈ 1 WETH', '≈ 1 WETH']);
  await other.close();
});

test('a late response from another tab cannot replace a newer verified holding or its price', async ({ page, context }) => {
  await fixture(page); await page.goto('/'); await add(page);
  const other = await context.newPage(); await fixture(other); await other.goto('/');
  await page.evaluate(() => { (window as any).__height = 2; (window as any).__hold = true; });
  await page.getByRole('button', { name: 'Refresh ' + address, exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__release)).toBe('function');
  await other.evaluate(() => (window as any).__height = 3);
  await other.getByRole('button', { name: 'Refresh ' + address, exact: true }).click();
  await expect(page.locator('.wallet .amount')).toHaveText(['3', '3']);
  await page.evaluate(() => (window as any).__release());
  await expect(page.getByRole('button', { name: 'Refresh ' + address, exact: true })).toBeEnabled();
  await expect(page.locator('.wallet .amount')).toHaveText(['3', '3']);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).wallets[0].balances.eth.verifiedBlock.number)).toBe('0x3');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).wallets[0].balances.eth.estimate.blockHash)).toBe('0x' + '3'.padStart(64, '0'));
  await other.close();
});

for (const failure of ['balance', 'price']) test(`a quote change queued during a ${failure} failure refreshes every holding`, async ({ page }) => {
  await page.clock.install(); await fixture(page); await page.goto('/'); await add(page);
  await page.evaluate(failure => {
    (window as any).__hold = true;
    if (failure === 'balance') (window as any).__balanceFailure = true;
    else (window as any).__failure = 'Private eth_getProof timed out after 90 seconds.';
  }, failure);
  await page.getByRole('button', { name: 'Refresh ' + address, exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__release)).toBe('function');
  await setQuote(page);
  await page.evaluate(() => { (window as any).__hold = false; (window as any).__release(); });
  await expect.poll(() => page.evaluate(() => (window as any).__runs.length)).toBe(3);
  await expect(page.getByRole('button', { name: 'Refresh ' + address, exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__runs.map((run: any) => ({ tokens: run.tokens, quote: run.pricing.quote.address })))).toEqual([
    { tokens: ['eth', weth], quote: usdc }, { tokens: ['eth', weth], quote: usdc }, { tokens: ['eth', weth], quote: weth },
  ]);
  await expect(page.locator('.wallet .price-estimate')).toHaveText(['≈ 1 WETH', '≈ 1 WETH']);
  expect(new Set((await page.evaluate(() => (window as any).__privateCalls)).map((call: any) => call.key)).size).toBe(1);
  await page.clock.runFor(65000);
  expect(await page.evaluate(() => (window as any).__runs.length)).toBe(3);
});
