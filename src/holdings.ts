import { tokenBalance, type Wallet } from './balances';
import type { Token } from './tokens';

// Hide only a proven current zero. Missing, legacy, cached and failed reads stay
// visible, including a failed refresh of a previously zero-valued holding.
export function partitionHoldings(wallet: Wallet, tokens: Token[]) {
  const visible: Token[] = [], zero: Token[] = [];
  for (const token of tokens) {
    const balance = tokenBalance(wallet, token);
    (balance.amount === 0n && balance.verifiedBlock && !balance.cached && !balance.failed ? zero : visible).push(token);
  }
  return { visible, zero };
}
