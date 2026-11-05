import { WETH } from './config';
import { getAddress, isAddress, type Address } from 'viem';
import { makeWallet, setTokenBalance, tokenBalance, type Balance, type Wallet } from './balances';
import { defaultTokens, validateToken, type Token } from './tokens';

const LEGACY_KEY = 'anonfolio.wallets.v1';
// Keep the storage key so existing installations migrate in place.
export const PORTFOLIO_KEY = 'anonfolio.portfolio.v2';
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
export function loadAddresses(): Address[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]');
    if (!Array.isArray(data)) return [];
    return [...new Set(data.filter((s): s is string => typeof s === 'string' && isAddress(s)).map(address => getAddress(address)))];
  } catch { return []; }
}
export function saveAddresses(addresses: Address[]): boolean {
  try { localStorage.setItem(LEGACY_KEY, JSON.stringify(addresses)); return true; }
  catch { return false; }
}
function restoreBalance(value: unknown): Balance {
  if (!record(value) || typeof value.amount !== 'string' || !/^\d{1,78}$/.test(value.amount)
    || typeof value.updatedAt !== 'number' || !Number.isSafeInteger(value.updatedAt)
    || value.updatedAt <= 0 || value.updatedAt > Date.now() + 60_000) return { failed: false };
  const amount = BigInt(value.amount);
  if (amount >= 2n ** 256n) return { failed: false };
  return { amount, updatedAt: value.updatedAt, failed: value.failed === true, cached: true };
}
export function loadPortfolio(rpcUrls: string[]): { wallets: Wallet[]; tokens: Token[] } {
  let data: unknown;
  try { data = JSON.parse(localStorage.getItem(PORTFOLIO_KEY) || 'null'); } catch { /* use v1 */ }
  const tokens: Token[] = [];
  const wallets: Wallet[] = [];
  if (record(data) && (data.version === 2 || data.version === 3) && Array.isArray(data.wallets) && Array.isArray(data.tokens)) {
    if (data.version === 2) tokens.push(...defaultTokens());
    for (const entry of data.tokens) {
      if (!record(entry) || typeof entry.address !== 'string' || typeof entry.symbol !== 'string'
        || typeof entry.decimals !== 'number') continue;
      try {
        let token: Token;
        try {
          token = validateToken(entry.address, entry.symbol, String(entry.decimals),
            typeof entry.icon === 'string' ? entry.icon : undefined);
        } catch {
          // A broken icon must not discard otherwise valid token configuration.
          token = validateToken(entry.address, entry.symbol, String(entry.decimals));
        }
        if (!tokens.some(t => t.address === token.address)) tokens.push(token);
      } catch { /* skip invalid token definitions */ }
    }
    for (const entry of data.wallets) {
      if (!record(entry) || typeof entry.address !== 'string' || !isAddress(entry.address)) continue;
      const address = getAddress(entry.address);
      if (wallets.some(wallet => wallet.address === address)) continue;
      const wallet = makeWallet(address, rpcUrls[wallets.length % rpcUrls.length]!);
      for (const token of tokens) {
        const value = data.version === 3
          ? record(entry.balances) ? entry.balances[token.address] : undefined
          : token.address === 'eth' ? entry.eth
          : token.address === WETH ? entry.weth
          : record(entry.tokens) ? entry.tokens[token.address] : undefined;
        setTokenBalance(wallet, token, restoreBalance(value));
      }
      wallets.push(wallet);
    }
  } else {
    tokens.push(...defaultTokens());
    loadAddresses().forEach((address, i) => wallets.push(makeWallet(address, rpcUrls[i % rpcUrls.length]!)));
  }
  return { wallets, tokens };
}
function savedBalance(balance: Balance) {
  return balance.amount === undefined ? undefined
    : { amount: balance.amount.toString(), updatedAt: balance.updatedAt, failed: balance.failed };
}
export function savePortfolio(wallets: Wallet[], tokens: Token[]): boolean {
  try {
    localStorage.setItem(PORTFOLIO_KEY, JSON.stringify({
      version: 3, tokens,
      wallets: wallets.map(wallet => ({
        address: wallet.address,
        balances: Object.fromEntries(tokens.map(token => [token.address, savedBalance(tokenBalance(wallet, token))])),
      })),
    }));
    return true;
  } catch { return false; }
}
