import type { Token } from '../tokens';
import type { VerificationStage } from './progress';

// Two bounded lanes: one balance and one oracle at a time on this wallet's route.
// Neither lane depends on the other's result; consumers join results by block hash.
export async function parallelReads(tokens: Token[], balance: (token: Token) => Promise<void>, price: (token: Token) => Promise<void>, progress: (stage: VerificationStage) => void) {
  let balancesDone = false, pricesDone = false;
  const update = () => progress(balancesDone ? 'pricing' : pricesDone ? 'balances' : 'balances-pricing');
  update();
  await Promise.all([
    (async () => { for (const token of tokens) await balance(token); balancesDone = true; if (!pricesDone) update(); })(),
    (async () => { for (const token of tokens) await price(token); pricesDone = true; if (!balancesDone) update(); })(),
  ]);
}
