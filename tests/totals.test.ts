import { expect, test } from 'bun:test';
import { makeWallet } from '../src/balances';
import { portfolioTotals } from '../src/totals';
import { validateToken } from '../src/tokens';

const a = makeWallet('0x0000000000000000000000000000000000000001', 'https://rpc.invalid');
const b = makeWallet('0x0000000000000000000000000000000000000002', 'https://rpc.invalid');

test('missing balances are not counted as successful zeroes', () => {
  const first = makeWallet(a.address, a.rpcUrl);
  const second = makeWallet(b.address, b.rpcUrl);
  first.eth = { amount: 0n, failed: false };
  second.eth.failed = true;
  const total = portfolioTotals([first, second], [])[0]!;
  expect(total.amount).toBe(0n);
  expect(total.known).toBe(1);
  expect(total.addresses).toBe(2);
  expect(portfolioTotals([second], [])[0]!.amount).toBeUndefined();
  expect(portfolioTotals([], [])[0]!.amount).toBeUndefined();
});

test('totals sum exact raw bigint balances per contract and retain each token decimals', () => {
  const first = makeWallet(a.address, a.rpcUrl);
  const second = makeWallet(b.address, b.rpcUrl);
  const usdc = validateToken('0x0000000000000000000000000000000000000003', 'USD', '6');
  const other = validateToken('0x0000000000000000000000000000000000000004', 'USD', '18');
  first.eth = { amount: 123456789012345678901n, failed: false };
  second.eth = { amount: 1n, failed: false };
  first.weth = { amount: 3n, failed: false };
  second.weth = { amount: 5n, failed: false };
  first.tokens[usdc.address] = { amount: 1234567n, failed: false };
  second.tokens[usdc.address] = { amount: 2000000n, failed: false };
  first.tokens[other.address] = { amount: 10n, failed: false };
  const totals = portfolioTotals([first, second], [usdc, other]);
  expect(totals.map(total => total.amount)).toEqual([123456789012345678902n, 8n, 3234567n, 10n]);
  expect(totals.map(total => total.decimals)).toEqual([18, 18, 6, 18]);
  expect(totals[2]!.known).toBe(2);
  expect(totals[3]!.known).toBe(1);
  expect(portfolioTotals([first], [usdc])[2]!.amount).toBe(1234567n);
});

test('cached and failed amounts remain included but are marked stale, separately from pending updates', () => {
  const first = makeWallet(a.address, a.rpcUrl);
  const second = makeWallet(b.address, b.rpcUrl);
  first.eth = { amount: 7n, cached: true, failed: false };
  second.eth = { amount: 3n, failed: true };
  second.loading = true;
  second.activity = [{ asset: 'eth', symbol: 'ETH', description: '', phase: 'requesting', attempt: 1 }];
  const total = portfolioTotals([first, second], [])[0]!;
  expect(total.amount).toBe(10n);
  expect(total.stale).toBe(2);
  expect(total.loading).toBe(1);
  expect(total.known).toBe(2);
  first.eth = { amount: 8n, failed: false };
  second.eth = { amount: 4n, failed: false };
  second.activity[0]!.phase = 'received';
  expect(portfolioTotals([first, second], [])[0]!.stale).toBe(0);
  expect(portfolioTotals([first, second], [])[0]!.loading).toBe(0);
});
