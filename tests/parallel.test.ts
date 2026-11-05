import { expect, test } from 'bun:test';
import { parallelReads } from '../src/verification/parallel';
import { defaultTokens } from '../src/tokens';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('price queries start before balance proofs finish, with one operation per lane', async () => {
  const balances = gate(), prices = gate();
  const started: string[] = [], stages: string[] = [];
  let done = false;
  const work = parallelReads(defaultTokens(), async token => { started.push('balance:'+token.symbol); await balances.promise; },
    async token => { started.push('price:'+token.symbol); await prices.promise; }, stage => stages.push(stage)).then(()=>{done=true;});
  expect(started).toEqual(['balance:ETH','price:ETH']);
  expect(stages).toEqual(['balances-pricing']);
  prices.release(); await Bun.sleep(0);
  expect(started).toEqual(['balance:ETH','price:ETH','price:WETH']);
  expect(stages.at(-1)).toBe('balances');
  expect(done).toBe(false);
  balances.release(); await work;
  expect(started.at(-1)).toBe('balance:WETH');
  expect(done).toBe(true);
});

test('slow price queries do not block proving subsequent balances', async () => {
  const prices = gate();
  const proved: string[] = [], stages: string[] = [];
  const work = parallelReads(defaultTokens(), async token => { proved.push(token.symbol); }, async () => { await prices.promise; }, stage=>stages.push(stage));
  await Bun.sleep(0);
  expect(proved).toEqual(['ETH','WETH']);
  expect(stages.at(-1)).toBe('pricing');
  prices.release(); await work;
});
