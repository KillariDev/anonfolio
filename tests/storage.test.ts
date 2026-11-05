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
