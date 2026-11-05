import { expect, test } from 'bun:test';
import { formatBalance, makeWallet, readBalances, tokenBalance } from '../src/balances';
import { defaultTokens, validateToken } from '../src/tokens';
import type { verifyWallet, VerificationEvent } from '../src/verification/client';
const address = '0x0000000000000000000000000000000000000001';
const block = { hash: '0x' + '11'.repeat(32), stateRoot: '0x' + '22'.repeat(32), number: '0x100', timestamp: Date.now() - 60_000 };
const unusedWorker = { fetch: async () => { throw new Error('Unexpected network use'); } };
function engine(run: (tokens: ReturnType<typeof defaultTokens>, emit: (event: VerificationEvent) => void) => void): typeof verifyWallet {
  return async (_wallet, _worker, tokens, emit) => run(tokens, emit);
}
const success = engine((tokens, emit) => {
  for (const token of tokens) emit({ type: 'balance', asset: token.address, amount: '0', decimals: 18, decimalsVerified: true, block });
});
test('verified zero keeps its finalized block identity, timestamp and decimals', async () => {
  const wallet = makeWallet(address, 'https://one.example');
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, false, success);
  expect(wallet.eth).toMatchObject({ amount: 0n, failed: false, verifiedBlock: block, decimalsVerified: true });
  expect(wallet.weth.verifiedBlock).toEqual(wallet.eth.verifiedBlock);
});
test('failed verification retains previous amounts and provenance as stale', async () => {
  const wallet = makeWallet(address, 'https://one.example');
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, false, success);
  const before = { ...wallet.eth };
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, false, async () => { throw new Error('Proof invalid'); });
  expect(wallet.eth).toEqual({ ...before, failed: true });
  expect(wallet.verificationStatus).toContain('Proof invalid');
});
test('legacy and cached balances are reverified rather than treated as proven zero', async () => {
  const wallet = makeWallet(address, 'https://one.example');
  wallet.eth = { amount: 0n, updatedAt: 1, cached: true, failed: false };
  let selected = 0;
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, true, engine((tokens, emit) => {
    selected = tokens.length;
    tokens.forEach(token => emit({ type: 'balance', asset: token.address, amount: '1', decimals: 18, decimalsVerified: true, block }));
  }));
  expect(selected).toBe(2);
  expect(wallet.eth.cached).toBeUndefined();
  expect(wallet.eth.verifiedBlock).toEqual(block);
});
test('partial success stores independently while failed assets retain old amounts', async () => {
  const wallet = makeWallet(address, 'https://one.example');
  wallet.weth = { amount: 9n, updatedAt: 1, failed: false };
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, false, engine((tokens, emit) => {
    emit({ type: 'balance', asset: 'eth', amount: '5', decimals: 18, decimalsVerified: true, block });
    emit({ type: 'asset-error', asset: tokens[1]!.address, error: 'Tampered code' });
  }));
  expect(wallet.eth.amount).toBe(5n);
  expect(wallet.weth).toEqual({ amount: 9n, updatedAt: 1, failed: true });
});
test('automatic recovery selects failed assets and keeps their original private identity', async () => {
  const wallet = makeWallet(address, 'https://one.example');
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, false, success);
  wallet.weth.failed = true;
  const key = wallet.isolationKey;
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, true, engine((tokens, emit) => {
    expect(tokens.map(token => token.symbol)).toEqual(['WETH']);
    emit({ type: 'balance', asset: tokens[0]!.address, amount: '7', decimals: 18, decimalsVerified: true, block });
  }));
  expect(wallet.isolationKey).toBe(key);
  expect(wallet.weth.amount).toBe(7n);
});
test('custom tokens retain verified or explicitly user-supplied decimals and progress', async () => {
  const token = validateToken('0x0000000000000000000000000000000000000002', 'CUSTOM', '6');
  const wallet = makeWallet(address, 'https://one.example');
  let updates = 0;
  await readBalances(wallet, unusedWorker, [token], () => updates++, false, engine((_tokens, emit) => {
    emit({ type: 'progress', message: 'Verifying proxy storage' });
    emit({ type: 'asset', asset: token.address });
    emit({ type: 'balance', asset: token.address, amount: '12345', decimals: 8, decimalsVerified: true, block });
  }));
  expect(tokenBalance(wallet, token).decimals).toBe(8);
  expect(wallet.verificationStatus).toContain('Verification complete');
  expect(updates).toBeGreaterThan(2);
});
test('amounts without verified block metadata are not accepted', async () => {
  const wallet = makeWallet(address, 'https://one.example');
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, false, engine((_tokens, emit) => emit({ type: 'balance', asset: 'eth', amount: '0' })));
  expect(wallet.eth.amount).toBeUndefined();
  expect(wallet.eth.failed).toBe(true);
});
test('display uses exact integer rounding, at most two decimals and explicit tiny positives', () => {
  expect(formatBalance(123456789n, 6)).toBe('123.46');
  expect(formatBalance(1n)).toBe('<0.01');
  expect(formatBalance(0n)).toBe('0');
  expect(formatBalance(99999999999999999999999999999n, 18)).toBe('100000000000');
});
