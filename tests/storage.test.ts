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
import { validateToken, defaultTokens } from '../src/tokens';
const operators = ['https://one.invalid', 'https://two.invalid'];

test('portfolio migrates a legacy watchlist with fresh random keys', () => {
  values.set(key, JSON.stringify([address]));
  const first = loadPortfolio(operators);
  const second = loadPortfolio(operators);
  expect(first.wallets[0]!.address).toBe(getAddress(address));
  expect(first.wallets[0]!.isolationKey).not.toBe(second.wallets[0]!.isolationKey);
  expect(first.tokens).toEqual(defaultTokens());
});

test('portfolio round-trip saves bigint values and token settings, marking restored data as cached', () => {
  const token = validateToken('0x0000000000000000000000000000000000000001', 'USDC', '6');
  const wallet = makeWallet(getAddress(address), operators[0]!);
  const timestamp = Date.now() - 5000;
  wallet.eth = { amount: 0n, updatedAt: timestamp, failed: false };
  wallet.weth = { amount: 12345678901234567890123456789n, updatedAt: timestamp, failed: true };
  wallet.tokens[token.address] = { amount: 1234567n, updatedAt: timestamp, failed: false };
  expect(savePortfolio([wallet], [...defaultTokens(), token])).toBe(true);
  const serialized = values.get(PORTFOLIO_KEY)!;
  expect(serialized).not.toContain(wallet.isolationKey);
  expect(serialized).not.toContain(wallet.rpcUrl);
  const restored = loadPortfolio(operators);
  expect(restored.tokens).toEqual([...defaultTokens(), token]);
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
  expect(restored.tokens).toEqual(defaultTokens());
});

test('removing all wallets does not resurrect the legacy watchlist', () => {
  values.set(key, JSON.stringify([address]));
  savePortfolio([], []);
  expect(loadPortfolio(operators).wallets).toEqual([]);
});

test('blocked portfolio storage keeps an in-memory session usable', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  expect(loadPortfolio(operators)).toEqual({ wallets: [], tokens: defaultTokens() });
  expect(savePortfolio([], [])).toBe(false);
});

test('removing default tokens and an empty tracked-token list survive reload', () => {
  const wallet = makeWallet(getAddress(address), operators[0]!);
  savePortfolio([wallet], [defaultTokens()[1]!]);
  expect(loadPortfolio(operators).tokens.map(token => token.symbol)).toEqual(['WETH']);
  savePortfolio([wallet], []);
  expect(loadPortfolio(operators).tokens).toEqual([]);
});
test('legacy v2 data migrates balances and adds default tokens once', () => {
  const timestamp = Date.now() - 1000;
  values.set(PORTFOLIO_KEY, JSON.stringify({
    version: 2, tokens: [], wallets: [{ address, eth: { amount: '123', updatedAt: timestamp }, weth: { amount: '456', updatedAt: timestamp } }],
  }));
  const portfolio = loadPortfolio(operators);
  expect(portfolio.tokens).toEqual(defaultTokens());
  expect(portfolio.wallets[0]!.eth.amount).toBe(123n);
  expect(portfolio.wallets[0]!.weth.amount).toBe(456n);
  savePortfolio(portfolio.wallets, portfolio.tokens.slice(1));
  expect(loadPortfolio(operators).tokens).toHaveLength(1);
});
test('uploaded icons survive storage and unsafe icon URLs do not discard the token', () => {
  const token = validateToken('0x0000000000000000000000000000000000000001', 'TEST', '6', 'data:image/png;base64,YQ==');
  savePortfolio([], [token]);
  expect(loadPortfolio(operators).tokens[0]!.icon).toBe(token.icon);
  const data = JSON.parse(values.get(PORTFOLIO_KEY)!);
  data.tokens[0].icon = 'https://tracker.invalid/logo.png';
  values.set(PORTFOLIO_KEY, JSON.stringify(data));
  expect(loadPortfolio(operators).tokens).toEqual([{ address: token.address, symbol: 'TEST', decimals: 6 }]);
});

test('address names persist alongside balances and malformed names do not discard cached wallets', () => {
  const wallet = makeWallet(getAddress(address), operators[0]!);
  wallet.name = 'Savings';
  wallet.eth = { amount: 42n, updatedAt: Date.now(), failed: false };
  expect(savePortfolio([wallet], defaultTokens())).toBe(true);
  expect(loadPortfolio(operators).wallets[0]!.name).toBe('Savings');
  const snapshot = JSON.parse(values.get(PORTFOLIO_KEY)!);
  for (const name of [null, 123, 'x'.repeat(81), 'bad\nname']) {
    snapshot.wallets[0].name = name;
    values.set(PORTFOLIO_KEY, JSON.stringify(snapshot));
    const restored = loadPortfolio(operators).wallets[0]!;
    expect(restored.name).toBeUndefined();
    expect(restored.eth.amount).toBe(42n);
  }
});

test('verified provenance and on-chain decimals survive storage but remain stale until reverified', () => {
  const wallet = makeWallet(getAddress(address), operators[0]!);
  const block = { hash: '0x' + '11'.repeat(32), stateRoot: '0x' + '22'.repeat(32), number: '0x100', timestamp: Date.now() - 60_000 };
  wallet.weth = { amount: 0n, failed: false, updatedAt: Date.now(), verifiedBlock: block, decimals: 18, decimalsVerified: true };
  expect(savePortfolio([wallet], defaultTokens())).toBe(true);
  expect(loadPortfolio(operators).wallets[0]!.weth).toMatchObject({ amount: 0n, cached: true, verifiedBlock: block, decimals: 18, decimalsVerified: true });
});

test('last failure survives reload for saved and unavailable balances without losing provenance', () => {
  const wallet = makeWallet(getAddress(address), operators[0]!);
  const failure = { message: 'Private eth_getProof rejected (-32602): distance to target block exceeds maximum proof window', stage: 'Fetching proof', at: Date.now() };
  wallet.eth = { amount: 7n, updatedAt: Date.now(), failed: true, failure };
  wallet.weth = { failed: true, failure };
  expect(savePortfolio([wallet], defaultTokens())).toBe(true);
  const restored = loadPortfolio(operators).wallets[0]!;
  expect(restored.eth).toMatchObject({ amount: 7n, failed: true, failure, cached: true });
  expect(restored.weth).toMatchObject({ failed: true, failure, cached: true });
  expect(restored.weth.amount).toBeUndefined();
});
