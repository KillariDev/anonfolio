import type { Balance, Wallet } from './balances';
import { wethToken, type Token } from './tokens';

export function portfolioTotals(wallets: Wallet[], tokens: Token[]) {
  const assets = [
    { id: 'eth', symbol: 'ETH', decimals: 18, address: undefined as string | undefined },
    ...[wethToken, ...tokens].map(token => ({ id: token.address, ...token })),
  ];
  return assets.map(asset => {
    let amount = 0n;
    let known = 0;
    let stale = 0;
    let loading = 0;
    for (const wallet of wallets) {
      const balance: Balance | undefined = asset.id === 'eth' ? wallet.eth
        : asset.id === wethToken.address ? wallet.weth : wallet.tokens[asset.id];
      if (balance?.amount !== undefined) {
        amount += balance.amount;
        known++;
        if (balance.cached || balance.failed) stale++;
      }
      if (wallet.loading && wallet.activity.some(item => item.asset === asset.id
        && (item.phase === 'waiting' || item.phase === 'requesting'))) loading++;
    }
    return { ...asset, amount: known ? amount : undefined, known, stale, loading, addresses: wallets.length };
  });
}
