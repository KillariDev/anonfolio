import { afterEach, expect, test } from 'bun:test';
import { encodeAbiParameters, type Address } from 'viem';
import { formatBalance, makeWallet, readBalances, type PrivateWorker } from '../src/balances';
import { WETH } from '../src/config';

const addressA = '0x0000000000000000000000000000000000000001' as Address;
const addressB = '0x0000000000000000000000000000000000000002' as Address;
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('two wallets use distinct keys and operators; only latest ETH and WETH calls, no public fetch or batches', async () => {
  const calls: { url: string; body: any; key: string }[] = [];
  globalThis.fetch = (() => { throw new Error('PUBLIC FETCH FORBIDDEN'); }) as unknown as typeof fetch;
  const worker: PrivateWorker = { fetch: async (url, init) => {
    const body = JSON.parse(init!.body as string);
    calls.push({ url: String(url), body, key: init!.anonOptions!.isolationKey! });
    return Response.json({ jsonrpc: '2.0', id: body.id, result: body.method === 'eth_getBalance' ? '0x0' : '0x' + '0'.repeat(64) });
  } };
  const a = makeWallet(addressA, 'https://operator-a.invalid');
  const b = makeWallet(addressB, 'https://operator-b.invalid');
  await Promise.all([readBalances(a, worker), readBalances(b, worker)]);
  expect(a.isolationKey).not.toBe(b.isolationKey);
  expect(calls).toHaveLength(4);
  for (const wallet of [a, b]) {
    const own = calls.filter(c => c.key === wallet.isolationKey);
    expect(own).toHaveLength(2);
    expect(own.every(c => new URL(c.url).href === new URL(wallet.rpcUrl).href)).toBe(true);
    expect(own.every(c => !Array.isArray(c.body))).toBe(true);
    const eth = own.find(c => c.body.method === 'eth_getBalance')!;
    const weth = own.find(c => c.body.method === 'eth_call')!;
    expect(eth.body.params).toEqual([wallet.address, 'latest']);
    expect(weth.body.params[1]).toBe('latest');
    expect(weth.body.params[0].to.toLowerCase()).toBe(WETH.toLowerCase());
    expect(weth.body.params[0].data).toBe('0x70a08231' + wallet.address.slice(2).padStart(64, '0'));
    expect(wallet.eth.amount).toBe(0n);
    expect(wallet.weth.amount).toBe(0n);
    expect(wallet.eth.failed).toBe(false);
  }
});

test('failed refresh preserves amounts and timestamp; retries keep the same private route', async () => {
  const wallet = makeWallet(addressA, 'https://operator-a.invalid');
  let failing = false;
  const keys: string[] = [];
  const worker: PrivateWorker = { fetch: async (_, init) => {
    keys.push(init!.anonOptions!.isolationKey!);
    const body = JSON.parse(init!.body as string);
    if (failing) throw new Error('Private route unavailable');
    return Response.json({ jsonrpc: '2.0', id: body.id,
      result: body.method === 'eth_getBalance' ? '0xde0b6b3a7640000' : '0x' + (2n * 10n ** 18n).toString(16).padStart(64, '0') });
  } };
  await readBalances(wallet, worker);
  const updatedAt = wallet.eth.updatedAt;
  failing = true;
  globalThis.fetch = (() => { throw new Error('PUBLIC FETCH FORBIDDEN'); }) as unknown as typeof fetch;
  await readBalances(wallet, worker);
  expect(wallet.eth.amount).toBe(10n ** 18n);
  expect(wallet.weth.amount).toBe(2n * 10n ** 18n);
  expect(wallet.eth.updatedAt).toBe(updatedAt);
  expect(wallet.eth.failed).toBe(true);
  expect(wallet.weth.failed).toBe(true);
  expect(keys.length).toBeGreaterThan(4);
  expect(new Set(keys)).toEqual(new Set([wallet.isolationKey]));
  failing = false;
  await readBalances(wallet, worker);
  expect(wallet.eth.failed).toBe(false);
});

test('partial failure preserves only the failed token and exact 18-decimal formatting', async () => {
  const wallet = makeWallet(addressA, 'https://operator-a.invalid');
  wallet.weth = { amount: 7n, updatedAt: 123, failed: false };
  await readBalances(wallet, { fetch: async (_, init) => {
    const body = JSON.parse(init!.body as string);
    return Response.json(body.method === 'eth_call'
      ? { jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'unavailable' } }
      : { jsonrpc: '2.0', id: body.id, result: '0x1' });
  } });
  expect(wallet.eth.amount).toBe(1n);
  expect(wallet.eth.failed).toBe(false);
  expect(wallet.weth).toEqual({ amount: 7n, updatedAt: 123, failed: true });
  expect(formatBalance(1n)).toBe('0.000000000000000001');
  expect(formatBalance(1234567890123456789n)).toBe('1.234567890123456789');
});

test('off-chain lookup redirects cannot escape the private transport', async () => {
  let publicFetches = 0;
  globalThis.fetch = (() => { publicFetches++; throw new Error('PUBLIC FETCH FORBIDDEN'); }) as unknown as typeof fetch;
  const wallet = makeWallet(addressA, 'https://operator-a.invalid');
  const data = '0x556f1830' + encodeAbiParameters(
    [{ type: 'address' }, { type: 'string[]' }, { type: 'bytes' }, { type: 'bytes4' }, { type: 'bytes' }],
    [WETH, ['https://leak.invalid/{data}'], '0x1234', '0x12345678', '0x'],
  ).slice(2);
  await readBalances(wallet, { fetch: async (_, init) => {
    const body = JSON.parse(init!.body as string);
    return Response.json(body.method === 'eth_getBalance'
      ? { jsonrpc: '2.0', id: body.id, result: '0x0' }
      : { jsonrpc: '2.0', id: body.id, error: { code: 3, message: 'execution reverted', data } });
  } });
  expect(publicFetches).toBe(0);
  expect(wallet.weth.failed).toBe(true);
});
