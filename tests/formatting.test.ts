import { expect, test } from 'bun:test';
import { formatBalance, exactBalance } from '../src/formatting';
test('grouping and two-place rounding never convert uint256 values to a floating-point number',()=>{
  expect(formatBalance(1850543140830000n,6)).toBe('1,850,543,140.83');
  expect(formatBalance(999995n,3)).toBe('1,000');
  expect(formatBalance(-1234567n,3)).toBe('-1,234.57');
  expect(formatBalance(1234567n,0)).toBe('1,234,567');
  expect(formatBalance(1n,18)).toBe('<0.01');
  expect(formatBalance(0n,18)).toBe('0');
  expect(exactBalance(1234567890123456789123456789n,18)).toBe('1,234,567,890.123456789123456789');
  expect(formatBalance(2n**256n-1n,0).replaceAll(',','')).toBe((2n**256n-1n).toString());
});
