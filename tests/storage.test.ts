import { afterEach, beforeEach, expect, test } from 'bun:test';
import { getAddress } from 'viem';
import { loadAddresses, saveAddresses } from '../src/storage';

const key = 'anonfolio.wallets.v1';
const address = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => { values.set(name, value); },
    },
  });
});
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('empty, malformed and incorrectly shaped storage start with an empty watchlist', () => {
  expect(loadAddresses()).toEqual([]);
  for (const value of ['{broken', 'null', '{}', '"address"', '42']) {
    values.set(key, value);
    expect(loadAddresses()).toEqual([]);
  }
});

test('stored addresses are validated, normalized and deduplicated', () => {
  values.set(key, JSON.stringify([null, 123, {}, 'bad-address', address, getAddress(address)]));
  expect(loadAddresses()).toEqual([getAddress(address)]);
});

test('saving persists only addresses and an empty list removes watched entries', () => {
  expect(saveAddresses([getAddress(address)])).toBe(true);
  expect([...values.keys()]).toEqual([key]);
  expect(JSON.parse(values.get(key)!)).toEqual([getAddress(address)]);
  expect(loadAddresses()).toEqual([getAddress(address)]);
  expect(saveAddresses([])).toBe(true);
  expect(loadAddresses()).toEqual([]);
});

test('blocked storage reads and writes fail gracefully', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('Storage blocked', 'SecurityError'); },
  });
  expect(loadAddresses()).toEqual([]);
  expect(saveAddresses([getAddress(address)])).toBe(false);
});

test('quota errors report that the watchlist was not saved', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { setItem() { throw new DOMException('Full', 'QuotaExceededError'); } },
  });
  expect(saveAddresses([getAddress(address)])).toBe(false);
});

import { loadPortfolio, PORTFOLIO_KEY, savePortfolio } from '../src/storage';
import { makeWallet } from '../src/balances';
import { validateToken } from '../src/tokens';
const operators = ['https://one.invalid', 'https://two.invalid'];

test('portfolio migrates a legacy watchlist with fresh random keys', () => {
  values.set(key, JSON.stringify([address]));
  const first = loadPortfolio(operators);
  const second = loadPortfolio(operators);
  expect(first.wallets[0]!.address).toBe(getAddress(address));
  expect(first.wallets[0]!.isolationKey).not.toBe(second.wallets[0]!.isolationKey);
  expect(first.tokens).toEqual([]);
});

test('portfolio round-trip saves bigint values and token settings, marking restored data as cached', () => {
  const token = validateToken('0x0000000000000000000000000000000000000001', 'USDC', '6');
  const wallet = makeWallet(getAddress(address), operators[0]!);
  const timestamp = Date.now() - 5000;
  wallet.eth = { amount: 0n, updatedAt: timestamp, failed: false };
  wallet.weth = { amount: 12345678901234567890123456789n, updatedAt: timestamp, failed: true };
  wallet.tokens[token.address] = { amount: 1234567n, updatedAt: timestamp, failed: false };
  expect(savePortfolio([wallet], [token])).toBe(true);
  const serialized = values.get(PORTFOLIO_KEY)!;
  expect(serialized).not.toContain(wallet.isolationKey);
  expect(serialized).not.toContain(wallet.rpcUrl);
  const restored = loadPortfolio(operators);
  expect(restored.tokens).toEqual([token]);
  expect(restored.wallets[0]!.eth).toEqual({ amount: 0n, updatedAt: timestamp, failed: false, cached: true });
  expect(restored.wallets[0]!.weth.amount).toBe(wallet.weth.amount);
  expect(restored.wallets[0]!.weth.failed).toBe(true);
  expect(restored.wallets[0]!.tokens[token.address]!.amount).toBe(1234567n);
});

test('corrupt cache entries are ignored without hiding valid wallets and token settings', () => {
  values.set(PORTFOLIO_KEY, JSON.stringify({
    version: 2,
    tokens: [{ address: 'bad', symbol: 'bad', decimals: -1 }],
    wallets: [
      { address, eth: { amount: '-1', updatedAt: Date.now() }, weth: { amount: '1', updatedAt: 'bad' } },
      { address: getAddress(address) }, { address: 'bad' },
    ],
  }));
  const restored = loadPortfolio(operators);
  expect(restored.wallets).toHaveLength(1);
  expect(restored.wallets[0]!.eth.amount).toBeUndefined();
  expect(restored.wallets[0]!.weth.amount).toBeUndefined();
  expect(restored.tokens).toEqual([]);
});

test('removing all wallets does not resurrect the legacy watchlist', () => {
  values.set(key, JSON.stringify([address]));
  savePortfolio([], []);
  expect(loadPortfolio(operators).wallets).toEqual([]);
});

test('blocked portfolio storage keeps an in-memory session usable', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  expect(loadPortfolio(operators)).toEqual({ wallets: [], tokens: [] });
  expect(savePortfolio([], [])).toBe(false);
});
