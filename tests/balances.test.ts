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
  for (const token of tokens) emit({ type: 'balance', asset: token.address, amount: '0', decimals: 18, block });
});
test('verified zero keeps its finalized block identity, timestamp and decimals', async () => {
  const wallet = makeWallet(address, 'https://one.example');
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, false, success);
  expect(wallet.eth).toMatchObject({ amount: 0n, failed: false, verifiedBlock: block });
  expect(wallet.weth.verifiedBlock).toEqual(wallet.eth.verifiedBlock);
});
test('failed verification retains previous amounts and provenance as stale', async () => {
  const wallet = makeWallet(address, 'https://one.example');
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, false, success);
  const before = { ...wallet.eth };
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, false, async () => { throw new Error('Proof invalid'); });
  expect(wallet.eth).toEqual({ ...before, failed: true, failure: expect.objectContaining({ message: 'Proof invalid' }) });
  expect(wallet.verificationStatus).toContain('Proof invalid');
});
test('legacy and cached balances are reverified rather than treated as proven zero', async () => {
  const wallet = makeWallet(address, 'https://one.example');
  wallet.eth = { amount: 0n, updatedAt: 1, cached: true, failed: false };
  let selected = 0;
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, true, engine((tokens, emit) => {
    selected = tokens.length;
    tokens.forEach(token => emit({ type: 'balance', asset: token.address, amount: '1', decimals: 18, block }));
  }));
  expect(selected).toBe(2);
  expect(wallet.eth.cached).toBeUndefined();
  expect(wallet.eth.verifiedBlock).toEqual(block);
});
test('partial success stores independently while failed assets retain old amounts', async () => {
  const wallet = makeWallet(address, 'https://one.example');
  wallet.weth = { amount: 9n, updatedAt: 1, failed: false };
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, false, engine((tokens, emit) => {
    emit({ type: 'balance', asset: 'eth', amount: '5', decimals: 18, block });
    emit({ type: 'progress', message: 'Pricing ETH in the other lane' });
    emit({ type: 'asset-error', asset: tokens[1]!.address, error: 'Tampered code', message: 'WETH balance verification' });
  }));
  expect(wallet.eth.amount).toBe(5n);
  expect(wallet.weth).toEqual({ amount: 9n, updatedAt: 1, failed: true, failure: expect.objectContaining({ message: 'Tampered code', stage: 'WETH balance verification' }) });
});
test('automatic recovery selects failed assets and keeps their original private identity', async () => {
  const wallet = makeWallet(address, 'https://one.example');
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, false, success);
  wallet.weth.failed = true;
  const key = wallet.isolationKey;
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, true, engine((tokens, emit) => {
    expect(tokens.map(token => token.symbol)).toEqual(['WETH']);
    emit({ type: 'balance', asset: tokens[0]!.address, amount: '7', decimals: 18, block });
  }));
  expect(wallet.isolationKey).toBe(key);
  expect(wallet.weth.amount).toBe(7n);
});
test('custom tokens always use configured decimals despite old verifier metadata', async () => {
  const token = validateToken('0x0000000000000000000000000000000000000002', 'CUSTOM', '6');
  const wallet = makeWallet(address, 'https://one.example');
  let updates = 0;
  await readBalances(wallet, unusedWorker, [token], () => updates++, false, engine((_tokens, emit) => {
    emit({ type: 'progress', message: 'Verifying proxy storage' });
    emit({ type: 'asset', asset: token.address });
    emit({ type: 'balance', asset: token.address, amount: '12345', decimals: 8, block });
  }));
  expect(tokenBalance(wallet, token).decimals).toBe(6);
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

test('oracle failure keeps proven balances available and marks only the estimate unavailable', async () => {
  const wallet = makeWallet(address, 'https://one.example');
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, false, engine((tokens, emit) => {
    for (const token of tokens) {
      emit({ type: 'balance', asset: token.address, amount: '7', decimals: 18, block });
      emit({ type: 'price-error', asset: token.address, error: 'No direct pool qualifies' });
    }
  }));
  expect(wallet.eth.amount).toBe(7n); expect(wallet.eth.failed).toBe(false);
  expect(wallet.eth.estimate).toBeUndefined(); expect(wallet.eth.priceError).toContain('No direct pool');
});
test('a quote event for another finalized block cannot attach to a proven balance', async () => {
  const wallet = makeWallet(address, 'https://one.example');
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, false, engine((_tokens, emit) => {
    emit({ type: 'balance', asset: 'eth', amount: '7', decimals: 18, block });
    emit({ type: 'price', asset: 'eth', block: { ...block, hash: '0x'+'33'.repeat(32) }, estimate: {} as any });
  }));
  expect(wallet.eth.estimate).toBeUndefined();
});

test('per-asset errors survive later progress and fatal errors; successful retry clears them', async () => {
  const wallet = makeWallet(address, 'https://one.example');
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, false, async (_wallet, _worker, tokens, emit) => {
    emit({ type: 'progress', message: 'ETH proof request' });
    emit({ type: 'asset-error', asset: 'eth', error: 'Missing requested storage slot proof.' });
    emit({ type: 'progress', message: 'WETH proof request' });
    throw new Error('Private RPC returned HTTP 429');
  });
  expect(wallet.eth.failure).toMatchObject({ message: 'Missing requested storage slot proof.', stage: 'ETH proof request' });
  expect(wallet.weth.failure).toMatchObject({ message: 'Private RPC returned HTTP 429', stage: 'WETH proof request' });
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, false, success);
  expect(wallet.eth.failure).toBeUndefined(); expect(wallet.weth.failure).toBeUndefined();
});

test('stage changes and concurrent request phases update independently and clear on failure', async () => {
  const wallet = makeWallet(address, 'https://one.example');
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, false, engine((_tokens, emit) => {
    emit({ type:'progress', stage:'consensus', message:'Syncing finalized headers' });
    expect(wallet.verificationStage).toBe('consensus');
    const start = wallet.stageStartedAt;
    const request = { requestId:1, method:'GET light_client/updates', host:'beacon.example', state:'waiting' as const, startedAt:1, deadline:90_001 };
    emit({ type:'network', request });
    emit({ type:'network', request:{ ...request, requestId:2 } });
    emit({ type:'network', request:{ ...request, state:'reading' } });
    expect(wallet.networkRequests?.map(r=>r.state)).toEqual(['waiting','reading']);
    expect(wallet.stageStartedAt).toBe(start);
    emit({ type:'network', request:{ ...request, state:'received' } });
    expect(wallet.networkRequests?.map(r=>r.requestId)).toEqual([2]);
    throw new Error('Private route unavailable');
  }));
  expect(wallet.networkRequests).toEqual([]);
  expect(wallet.eth.failed).toBe(true);
});

for (const outcome of ['same block','different block','failed balance'] as const) test('early oracle result waits for its balance proof: '+outcome, async () => {
  const wallet = makeWallet(address, 'https://one.example');
  const estimate = { blockHash:block.hash } as any;
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, false, engine((_tokens,emit) => {
    emit({type:'price-start',asset:'eth',stage:'balances-pricing'});
    expect(wallet.verificationStage).toBe('balances-pricing');
    emit({type:'price',asset:'eth',block,estimate});
    expect(wallet.eth.estimate).toBeUndefined();
    expect(wallet.eth.amount).toBeUndefined();
    if (outcome === 'failed balance') emit({type:'asset-error',asset:'eth',error:'Invalid account proof'});
    else emit({type:'balance',asset:'eth',amount:'3',block:outcome === 'same block' ? block : {...block,hash:'0x'+'33'.repeat(32)}});
  }));
  expect(wallet.eth.estimate).toEqual(outcome === 'same block' ? estimate : undefined);
});

test('an early oracle failure survives balance success without marking that balance failed', async () => {
  const wallet = makeWallet(address, 'https://one.example');
  await readBalances(wallet, unusedWorker, defaultTokens(), () => {}, false, engine((_tokens,emit) => {
    emit({type:'price-error',asset:'eth',error:'No direct pool qualifies'});
    emit({type:'balance',asset:'eth',amount:'0',block});
  }));
  expect(wallet.eth).toMatchObject({amount:0n,failed:false,priceError:'No direct pool qualifies'});
});

test('retrieval log retains earlier progress, failures and subsequent successful attempts',async()=>{
  const wallet=makeWallet(address,'https://one.example');
  await readBalances(wallet,unusedWorker,defaultTokens(),()=>{},false,engine((_tokens,emit)=>{
    emit({type:'progress',message:'Verifying checkpoint signatures'});
    emit({type:'progress',message:'Fetching private account proof'});
    throw new Error('Route timed out');
  }));
  const earlier=wallet.retrievalLog!.map(entry=>entry.message);
  expect(earlier.join(' ')).toContain('Verifying checkpoint signatures');
  expect(earlier.join(' ')).toContain('Route timed out');
  await readBalances(wallet,unusedWorker,defaultTokens(),()=>{},false,success);
  expect(wallet.retrievalLog!.slice(0,earlier.length).map(entry=>entry.message)).toEqual(earlier);
  expect(wallet.retrievalLog!.at(-1)!.level).toBe('success');
  expect(wallet.retrievalLog!.filter(entry=>entry.level==='error').length).toBeGreaterThan(0);
});
