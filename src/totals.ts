import { tokenBalance, type Wallet } from './balances';
import type { Token } from './tokens';

export function portfolioTotals(wallets: Wallet[], tokens: Token[]) {
  return tokens.map(token => {
    let amount = 0n;
    let known = 0;
    let stale = 0;
    let loading = 0;
    let userSuppliedDecimals = false;
    const blocks = new Set<string>();
    const decimals = new Set<number>();
    for (const wallet of wallets) {
      const balance = tokenBalance(wallet, token);
      if (balance.amount !== undefined) {
        blocks.add(balance.verifiedBlock?.hash || 'unverified');
        decimals.add(balance.decimals ?? token.decimals);
        userSuppliedDecimals ||= !balance.decimalsVerified && token.address !== 'eth';
        amount += balance.amount;
        known++;
        if (balance.cached || balance.failed) stale++;
      }
      if (wallet.loading && wallet.activity.some(item => item.asset === token.address
        && (item.phase === 'waiting' || item.phase === 'requesting'))) loading++;
    }
    return { ...token, decimals: decimals.size === 1 ? [...decimals][0]! : token.decimals, mixedBlocks: blocks.size > 1, decimalsMismatch: decimals.size > 1, userSuppliedDecimals, id: token.address, amount: known && decimals.size <= 1 ? amount : undefined, known, stale, loading, addresses: wallets.length };
  });
}
