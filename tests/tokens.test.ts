import { expect, test } from 'bun:test';
import { parseWalletList, validateToken } from '../src/tokens';
import { WETH } from '../src/config';

const address = '0x0000000000000000000000000000000000000001';
const other = '0x0000000000000000000000000000000000000002';
test('bulk wallet input accepts newlines, commas, spaces and semicolons and deduplicates', () => {
  expect(parseWalletList('  ' + address + ',\n' + other + '; ' + address)).toEqual([address, other]);
});
test('bulk wallet input rejects the whole list if any entry is invalid', () => {
  expect(() => parseWalletList(address + '\ninvalid')).toThrow('valid Ethereum address');
  expect(() => parseWalletList(' , \n ')).toThrow('valid Ethereum address');
});
test('custom token metadata is validated locally with exact decimal precision', () => {
  expect(validateToken(address, 'USDC', '6')).toEqual({ address, symbol: 'USDC', decimals: 6 });
  for (const decimals of ['-1', '256', '1.5', '1e2', '', 'NaN']) {
    expect(() => validateToken(address, 'TEST', decimals)).toThrow('decimals');
  }
  expect(validateToken(address, 'TEST', '0').decimals).toBe(0);
  expect(validateToken(address, 'TEST', '255').decimals).toBe(255);
  expect(() => validateToken('invalid', 'TEST', '18')).toThrow('contract address');
  expect(() => validateToken(address, '<script>', '18')).toThrow('symbol');
  expect(() => validateToken(WETH, 'WETH', '18')).toThrow('already tracked');
});
