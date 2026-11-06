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

import { loadPortfolio, PORTFOLIO_KEY, savePortfolio, syncPortfolio } from '../src/storage';
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

test('verified provenance and configured decimals survive storage but remain stale until reverified', () => {
  const wallet = makeWallet(getAddress(address), operators[0]!);
  const block = { hash: '0x' + '11'.repeat(32), stateRoot: '0x' + '22'.repeat(32), number: '0x100', timestamp: Date.now() - 60_000 };
  wallet.weth = { amount: 0n, failed: false, updatedAt: Date.now(), verifiedBlock: block, decimals: 18 };
  expect(savePortfolio([wallet], defaultTokens())).toBe(true);
  expect(loadPortfolio(operators).wallets[0]!.weth).toMatchObject({ amount: 0n, cached: true, verifiedBlock: block, decimals: 18 });
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


test('stale tabs merge independent addresses and never resurrect a removed address', () => {
  const first = loadPortfolio(operators), second = loadPortfolio(operators);
  const a = makeWallet('0x0000000000000000000000000000000000000001', operators[0]!);
  const b = makeWallet('0x0000000000000000000000000000000000000002', operators[1]!);
  first.wallets.push(a); second.wallets.push(b);
  expect(savePortfolio(first.wallets, first.tokens)).toBe(true);
  expect(savePortfolio(second.wallets, second.tokens)).toBe(true);
  a.eth = { amount: 7n, updatedAt: Date.now(), failed: false };
  expect(savePortfolio(first.wallets, first.tokens)).toBe(true);
  expect(first.wallets.map(wallet => wallet.address)).toEqual([a.address, b.address]);
  expect(first.wallets[0]).toBe(a);
  expect(loadPortfolio(operators).wallets).toHaveLength(2);
  second.wallets.splice(second.wallets.findIndex(wallet => wallet.address === a.address), 1);
  expect(savePortfolio(second.wallets, second.tokens)).toBe(true);
  // A late successful response in the stale tab must not recreate the row.
  a.eth.amount = 8n;
  expect(savePortfolio(first.wallets, first.tokens)).toBe(true);
  expect(first.wallets.map(wallet => wallet.address)).toEqual([b.address]);
  expect(loadPortfolio(operators).wallets.map(wallet => wallet.address)).toEqual([b.address]);
});
test('cross-tab sync preserves active wallet identity, local edits and atomic balance provenance', () => {
  const first = loadPortfolio(operators);
  first.wallets.push(makeWallet(getAddress(address), operators[0]!));
  savePortfolio(first.wallets, first.tokens);
  const second = loadPortfolio(operators);
  const active = second.wallets[0]!, isolation = active.isolationKey;
  active.loading = true;
  second.tokens[0]!.icon = 'builtin:weth'; // local edit not yet saved
  first.wallets[0]!.eth = { amount: 9n, updatedAt: Date.now(), failed: false };
  first.wallets[0]!.weth = { amount: 11n, updatedAt: Date.now(), failed: false };
  savePortfolio(first.wallets, first.tokens);
  syncPortfolio(second.wallets, second.tokens, operators);
  expect(second.wallets[0]).toBe(active);
  expect(active.isolationKey).toBe(isolation);
  expect(active.loading).toBe(true);
  expect(active.eth).toMatchObject({ amount: 9n, cached: true });
  expect(second.tokens[0]!.icon).toBe('builtin:weth');
  savePortfolio(second.wallets, second.tokens);
  expect(loadPortfolio(operators).tokens[0]!.icon).toBe('builtin:weth');
  expect(loadPortfolio(operators).wallets[0]!.weth.amount).toBe(11n);
});
test('a remote token removal wins over balances arriving in a stale tab', () => {
  const first = loadPortfolio(operators);
  const token = validateToken('0x0000000000000000000000000000000000000003', 'CUSTOM', '6');
  first.tokens.push(token);
  first.wallets.push(makeWallet(getAddress(address), operators[0]!));
  savePortfolio(first.wallets, first.tokens);
  const second = loadPortfolio(operators);
  first.tokens.splice(2, 1); savePortfolio(first.wallets, first.tokens);
  second.wallets[0]!.tokens[token.address] = { amount: 55n, updatedAt: Date.now(), failed: false };
  savePortfolio(second.wallets, second.tokens);
  expect(loadPortfolio(operators).tokens).toHaveLength(2);
  expect(second.tokens).toHaveLength(2);
  expect(second.wallets[0]!.tokens[token.address]).toBeUndefined();
});

for (const synchronize of [false, true]) test(`late older blocks cannot overwrite a newer cross-tab holding (storage event: ${synchronize})`, () => {
  const first = loadPortfolio(operators);
  first.wallets.push(makeWallet(getAddress(address), operators[0]!));
  const balance = (height: number) => ({ amount: BigInt(height), updatedAt: Date.now(), failed: false, decimals: 18,
    verifiedBlock: { hash: '0x' + height.toString(16).padStart(64, '0'), stateRoot: '0x' + '22'.repeat(32), number: '0x' + height.toString(16), timestamp: Date.now() - 60000 } });
  first.wallets[0]!.eth = balance(1); savePortfolio(first.wallets, first.tokens);
  const second = loadPortfolio(operators);
  first.wallets[0]!.eth = balance(3); savePortfolio(first.wallets, first.tokens);
  if (synchronize) syncPortfolio(second.wallets, second.tokens, operators);
  second.wallets[0]!.eth = { ...balance(2), updatedAt: Date.now() + 1000 };
  savePortfolio(second.wallets, second.tokens);
  expect(loadPortfolio(operators).wallets[0]!.eth).toMatchObject({ amount: 3n, verifiedBlock: { number: '0x3' } });
  expect(second.wallets[0]!.eth.amount).toBe(3n);
  // The losing tab must still be able to save unrelated metadata.
  second.wallets[0]!.name = 'Savings'; savePortfolio(second.wallets, second.tokens);
  expect(loadPortfolio(operators).wallets[0]!).toMatchObject({ name: 'Savings', eth: { amount: 3n } });
});

test('pricing errors and retry provenance survive reload and unsafe retry flags are recomputed', async () => {
  const { defaultPricing, priceFailure, retryPrice } = await import('../src/pricing');
  const wallet = makeWallet(getAddress(address), operators[0]!);
  wallet.eth = { amount: 5n, updatedAt: Date.now(), failed: false,
    priceError: 'Private eth_getProof timed out', priceFailure: priceFailure('Private eth_getProof timed out', defaultPricing()) };
  expect(savePortfolio([wallet], defaultTokens())).toBe(true);
  const restored = loadPortfolio(operators).wallets[0]!.eth;
  expect(restored).toMatchObject({ amount: 5n, failed: false, priceError: wallet.eth.priceError, priceFailure: wallet.eth.priceFailure });
  expect(retryPrice(restored, defaultPricing())).toBe(true);
  const data = JSON.parse(values.get(PORTFOLIO_KEY)!);
  data.wallets[0].balances.eth.priceFailure.message = 'No direct pool qualifies';
  data.wallets[0].balances.eth.priceFailure.retryable = true;
  values.set(PORTFOLIO_KEY, JSON.stringify(data));
  expect(retryPrice(loadPortfolio(operators).wallets[0]!.eth, defaultPricing())).toBe(false);
});
