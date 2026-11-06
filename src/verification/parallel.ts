import type { Token } from '../tokens';
import type { VerificationStage } from './progress';

// Drain active work before returning an error: a wallet route must not be released
// while any of its reads are still running. Stop starting new work after failure.
export async function mapConcurrent<T, R>(items: readonly T[], limit: number, read: (item: T) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid concurrency limit.');
  const results: R[] = [];
  let next = 0, failed = false, failure: unknown;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try { results[index] = await read(items[index]!); }
      catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  }));
  if (failed) throw failure;
  return results;
}

// Two balance and two oracle jobs can overlap on this wallet's frozen block.
// The enclosing wallet queue continues to serialize distinct private routes.
export async function parallelReads(tokens: Token[], balance: (token: Token) => Promise<void>, price: (token: Token) => Promise<void>, progress: (stage: VerificationStage) => void) {
  let balancesDone = false, pricesDone = false;
  const update = () => progress(balancesDone ? 'pricing' : pricesDone ? 'balances' : 'balances-pricing');
  update();
  const lanes = await Promise.allSettled([
    (async () => { await mapConcurrent(tokens, 2, balance); balancesDone = true; if (!pricesDone) update(); })(),
    (async () => { await mapConcurrent(tokens, 2, price); pricesDone = true; if (!balancesDone) update(); })(),
  ]);
  for (const lane of lanes) if (lane.status === 'rejected') throw lane.reason;
}
