import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { openAddressForm, openTokenSettings, openWalletDetails } from './helpers';

const accounts = [
  { name: 'vitalik.eth', address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
  { name: 'Ethereum Foundation', address: '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe' },
  { name: 'Uniswap treasury', address: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC' },
  { name: 'ENS DAO treasury', address: '0xFe89cc7aBB2C4183683ab71653C4cdc9B02D44b7' },
];
const ensIcon = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72/logo.png';
const directory = new URL('../screenshots/', import.meta.url);

test('capture ten real mainnet portfolio screenshots', async ({ page, request }) => {
  test.skip(process.env.SCREENSHOT_GALLERY !== '1', 'Opt-in live mainnet screenshot capture; writes screenshots/.');
  test.skip(!!process.env.BASE_URL || !!process.env.IPFS_GATEWAY_URL, 'Capture the current source application with Vite.');
  test.setTimeout(900_000);
  const localIcon = async (name: string) => 'data:image/png;base64,' + await readFile(new URL(`../src/assets/tokens/${name}.png`, import.meta.url), 'base64');
  const image = await request.get(ensIcon);
  expect(image.ok()).toBe(true);
  const tokens = [
    { address: 'eth', symbol: 'ETH', decimals: 18, icon: 'builtin:eth' },
    { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', decimals: 18, icon: 'builtin:weth' },
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6, icon: await localIcon('usdc') },
    { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', symbol: 'UNI', decimals: 18, icon: await localIcon('uni') },
    { address: '0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72', symbol: 'ENS', decimals: 18, icon: 'data:image/png;base64,' + (await image.body()).toString('base64') },
  ];
  const rpcUrls = ['https://eth.drpc.org/', 'https://ethereum-rpc.publicnode.com/'];
  const methods: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.postData()?.includes('jsonrpc')) {
      const body = request.postDataJSON();
      expect(Array.isArray(body)).toBe(false);
      methods.push(body.method);
    }
  });
  await page.addInitScript(({ tokens, rpcUrls }) => {
    localStorage.setItem('anonfolio.portfolio.v2', JSON.stringify({ version: 3, tokens, wallets: [] }));
    localStorage.setItem('anonfolio.network.v1', JSON.stringify({ mode: 'https', rpcUrls, gateways: ['152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ'] }));
  }, { tokens, rpcUrls });
  await mkdir(directory, { recursive: true });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  async function add(entries: typeof accounts) {
    await openAddressForm(page);
    await page.locator('#address').fill(entries.map(entry => entry.name + ' | ' + entry.address).join('\n'));
    await page.getByRole('button', { name: 'add address to track', exact: true }).click();
  }
  async function settled(count: number) {
    await expect.poll(() => page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('anonfolio.portfolio.v2') || 'null');
      return saved?.wallets.filter((wallet: any) => saved.tokens.every((token: any) => wallet.balances[token.address]?.verifiedBlock && !wallet.balances[token.address].failed && wallet.balances[token.address].amount !== undefined)).length;
    }), { timeout: 350_000, intervals: [1000, 3000, 5000] }).toBe(count);
    await expect(page.locator('.wallet[data-loading="true"]')).toHaveCount(0, { timeout: 90_000 });
    await expect(page.locator('#helios-status strong')).toHaveText('Helios · ready');
    await expect(page.locator('#connection')).toHaveText('Direct HTTPS · not anonymous');
  }
  const captures: any[] = [];
  async function capture(file: string, description: string, fullPage = true) {
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.locator('img:visible').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    // Opening long history/log disclosures can scroll the outer document.
    // Reset it so full-page captures paint the fixed gradient from the top.
    await page.evaluate(() => { window.scrollTo(0, 0); return new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    await expect(page.getByRole('tooltip')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: new URL(file, directory).pathname, animations: 'disabled', fullPage });
    const portfolio = await page.evaluate(() => JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!));
    const { tokens: _tokens, ...snapshot } = portfolio;
    captures.push({ file, description, capturedAt: new Date().toISOString(), viewport: page.viewportSize(), portfolio: snapshot });
    console.log('Captured ' + file + ': ' + portfolio.wallets.map((wallet: any) => wallet.name).join(', '));
  }
  async function remove(account: typeof accounts[number]) {
    await openWalletDetails(page, account.address + ' · ' + account.name);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Remove ' + account.address + ' · ' + account.name, exact: true }).click();
  }
  await add(accounts);
  await settled(accounts.length);
  const initial = await page.evaluate(() => JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!));
  for (const symbol of ['USDC', 'UNI', 'ENS']) {
    const token = tokens.find(token => token.symbol === symbol)!;
    expect(initial.wallets.some((wallet: any) => BigInt(wallet.balances[token.address].amount) > 0n)).toBe(true);
  }
  await capture('01-public-mainnet-portfolios.png', 'Four public accounts, five tracked assets, combined token totals and USDC estimates.');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTokenSettings(page);
  await capture('06-custom-erc20-tokens.png', 'ETH/WETH plus user-configured USDC, UNI and ENS with uploaded token icons.');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();

  const foundation = page.locator('.wallet').filter({ has: page.locator('.address-name', { hasText: 'Ethereum Foundation' }) });
  await openWalletDetails(page, accounts[1]!.address + ' · ' + accounts[1]!.name);
  await foundation.locator('.history-details > summary').click();
  await page.setViewportSize({ width: 1440, height: 1250 });
  await capture('07-finalized-balance-history.png', 'Ethereum Foundation balances with their actual verified finalized block and successful-read timestamps.');
  await foundation.locator('.history-details > summary').click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await foundation.locator('.retrieval-log > summary').click();
  // Frame the actual execution trace rather than the startup messages or tail.
  const proof = foundation.locator('.log-stream li').filter({ hasText: /storage proof|bytecode/ }).first();
  await proof.evaluate(node => {
    const root = node.closest<HTMLElement>('#wallets')!;
    root.scrollTop += node.getBoundingClientRect().top - root.getBoundingClientRect().top - 60;
  });
  await capture('08-local-verification-log.png', 'Actual timestamped Helios proof, bytecode and Uniswap oracle retrieval events.', false);
  await foundation.locator('.retrieval-log > summary').click();
  await openWalletDetails(page, accounts[1]!.address + ' · ' + accounts[1]!.name);
  await foundation.getByRole('button', { name: 'Details ' + accounts[1]!.address + ' · ' + accounts[1]!.name, exact: true }).click();

  await page.setViewportSize({ width: 1024, height: 900 });
  await capture('09-tablet-portfolios.png', 'Public mainnet portfolios in the tablet layout.');

  await page.setViewportSize({ width: 1440, height: 800 });
  for (const account of accounts.slice(1)) await remove(account);
  await capture('02-vitalik-eth.png', 'vitalik.eth: an individual public address with ETH, WETH and custom ERC-20 holdings.');
  for (const [index, file] of [[1, '03-ethereum-foundation.png'], [2, '04-uniswap-treasury.png'], [3, '05-ens-dao-treasury.png']] as const) {
    await add([accounts[index]!]);
    await settled(2);
    await remove(accounts[index - 1]!);
    await page.locator('#wallets').evaluate(root => { root.scrollTop = 0; });
    await capture(file, accounts[index]!.name + ': actual holdings and direct-pool 30-minute TWAP estimates.');
  }
  await page.setViewportSize({ width: 430, height: 932 });
  await capture('10-mobile-portfolios.png', 'ENS DAO treasury on mobile: compact token totals, named address and verified holdings.');
  expect(captures).toHaveLength(10);
  expect(methods).toContain('eth_getProof');
  expect(methods).not.toContain('eth_call');
  expect(methods).not.toContain('eth_getBalance');
  await writeFile(new URL('mainnet-snapshots.json', directory), JSON.stringify({
    transport: 'Direct HTTPS (not anonymous)', verification: 'Helios 0.12.0 finalized mainnet account/code/storage verification',
    rpcUrls, tokens, captures: captures.sort((left, right) => left.file.localeCompare(right.file)), rpcMethods: methods,
  }, null, 2) + '\n');
});
