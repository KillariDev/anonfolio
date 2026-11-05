import { tokenBalance, type Wallet } from './balances';
import type { Token } from './tokens';

export function portfolioTotals(wallets: Wallet[], tokens: Token[]) {
  return tokens.map(token => {
    let amount = 0n;
    let known = 0;
    let stale = 0;
    let loading = 0;
    for (const wallet of wallets) {
      const balance = tokenBalance(wallet, token);
      if (balance.amount !== undefined) {
        amount += balance.amount;
        known++;
        if (balance.cached || balance.failed) stale++;
      }
      if (wallet.loading && wallet.activity.some(item => item.asset === token.address
        && (item.phase === 'waiting' || item.phase === 'requesting'))) loading++;
    }
    return { ...token, id: token.address, amount: known ? amount : undefined, known, stale, loading, addresses: wallets.length };
  });
}
