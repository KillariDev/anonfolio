import { expect, test } from 'bun:test';
import { getAddress } from 'viem';
import { parseTrackedAddresses, validateAddressName } from '../src/addresses';
import { blockieData } from '../src/address-display';
const a = '0x0000000000000000000000000000000000000001';
const b = '0x0000000000000000000000000000000000000002';

test('names are optional, trimmed, bounded and never interpreted as addresses', () => {
  expect(parseTrackedAddresses(a, ' Savings ')).toEqual([{ address: a, name: 'Savings' }]);
  expect(parseTrackedAddresses(a)).toEqual([{ address: a }]);
  expect(validateAddressName('  ')).toBeUndefined();
  expect(() => validateAddressName('a'.repeat(81))).toThrow();
  expect(() => validateAddressName('bad\nname')).toThrow();
  expect(parseTrackedAddresses(a, '<img src=x onerror=alert(1)>')[0]!.name).toBe('<img src=x onerror=alert(1)>');
});
test('named lists validate atomically, preserve plain lists and deduplicate checksummed addresses', () => {
  expect(parseTrackedAddresses(`Savings | ${a}\n${b}`)).toEqual([{ address: a, name: 'Savings' }, { address: b }]);
  expect(parseTrackedAddresses(`${a}, ${b}; ${a}`)).toEqual([{ address: a }, { address: b }]);
  const address = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
  expect(parseTrackedAddresses(`Main | ${address}\nMain | ${getAddress(address)}`)).toHaveLength(1);
  expect(() => parseTrackedAddresses(`Valid | ${a}\nInvalid | nope`)).toThrow();
  expect(() => parseTrackedAddresses(`Name | ${a},${b}`)).toThrow();
  expect(() => parseTrackedAddresses(`${a},${b}`, 'One name')).toThrow();
  expect(() => parseTrackedAddresses(`Bad | format | ${a}`)).toThrow();
});
test('blockies are deterministic per address, case-insensitive, mirrored and use a three-color 8x8 grid', () => {
  const address = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
  expect(blockieData(address)).toEqual(blockieData(address.toUpperCase()));
  expect(blockieData(a)).not.toEqual(blockieData(b));
  const { cells, colors } = blockieData(a);
  expect(colors).toHaveLength(3);
  expect(cells).toHaveLength(64);
  expect(cells.every(cell => cell >= 0 && cell <= 2)).toBe(true);
  for (let y = 0; y < 8; y++) {
    const row = cells.slice(y * 8, y * 8 + 8);
    expect(row).toEqual([...row].reverse());
  }
});
