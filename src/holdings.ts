import { tokenBalance, type Wallet } from './balances';
import type { Token } from './tokens';

// Hide only a proven current zero. Missing, legacy, cached and failed reads stay
// visible, including a failed refresh of a previously zero-valued holding.
export function visibleHoldings(wallet: Wallet, tokens: Token[]) {
  return tokens.filter(token => {
    const balance = tokenBalance(wallet, token);
    return !(balance.amount === 0n && balance.verifiedBlock && !balance.cached && !balance.failed);
  });
}
