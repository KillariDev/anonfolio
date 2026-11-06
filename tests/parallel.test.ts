import { expect, test } from 'bun:test';
import { mapConcurrent, parallelReads } from '../src/verification/parallel';
import { defaultTokens } from '../src/tokens';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('price queries start before balance proofs finish, with two operations per lane', async () => {
  const balances = gate(), prices = gate();
  const started: string[] = [], stages: string[] = [];
  let done = false;
  const work = parallelReads(defaultTokens(), async token => { started.push('balance:'+token.symbol); await balances.promise; },
    async token => { started.push('price:'+token.symbol); await prices.promise; }, stage => stages.push(stage)).then(()=>{done=true;});
  expect(started).toEqual(['balance:ETH','balance:WETH','price:ETH','price:WETH']);
  expect(stages).toEqual(['balances-pricing']);
  prices.release(); await Bun.sleep(0);
  expect(started).toEqual(['balance:ETH','balance:WETH','price:ETH','price:WETH']);
  expect(stages.at(-1)).toBe('balances');
  expect(done).toBe(false);
  balances.release(); await work;
  expect(started).toHaveLength(4);
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

test('bounded scheduling starts the next read as soon as a slot is free and preserves input order', async () => {
  const gates = Array.from({length: 5}, gate), started: number[] = [];
  const work = mapConcurrent([0,1,2,3,4], 2, async i => { started.push(i); await gates[i]!.promise; return i*2; });
  expect(started).toEqual([0,1]);
  gates[1]!.release(); await Bun.sleep(0);
  expect(started).toEqual([0,1,2]);
  gates[2]!.release(); await Bun.sleep(0);
  expect(started).toEqual([0,1,2,3]);
  gates.forEach(g => g.release());
  expect(await work).toEqual([0,2,4,6,8]);
});

test('failed work drains active reads and stops queued work before releasing the route', async () => {
  const active = gate(); let drained = false;
  const started: number[] = [];
  const work = mapConcurrent([0,1,2,3], 2, async i => {
    started.push(i);
    if (i === 0) throw new Error('Proof rejected');
    await active.promise; drained = true;
  });
  let finished = false;
  const checked = work.catch(error => { expect(error.message).toBe('Proof rejected'); finished = true; });
  await Bun.sleep(0);
  expect(started).toEqual([0,1]); expect(finished).toBe(false);
  active.release(); await checked; expect(drained).toBe(true);
});

test('both lanes settle before a failed refresh releases its wallet route', async () => {
  const prices = gate(); let settled = false;
  const work = parallelReads(defaultTokens(), async () => { throw new Error('Failed balance'); }, async () => { await prices.promise; }, () => {});
  const checked = work.catch(() => { settled = true; });
  await Bun.sleep(0); expect(settled).toBe(false);
  prices.release(); await checked; expect(settled).toBe(true);
});
