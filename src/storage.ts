import { readFailure } from './errors';
import { WINDOW, type Estimate } from './pricing';
import { validateAddressName } from './addresses';
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
  if (!record(value)) return { failed: false };
  const failure = value.failed === true && record(value.failure) && typeof value.failure.message === 'string'
    && typeof value.failure.at === 'number' && Number.isSafeInteger(value.failure.at) && value.failure.at > 0 && value.failure.at <= Date.now() + 60_000
    ? { ...readFailure(value.failure.message, typeof value.failure.stage === 'string' ? value.failure.stage : undefined), at: value.failure.at } : undefined;
  const unavailable: Balance = failure ? { failed: true, failure, cached: true } : { failed: false };
  if (typeof value.amount !== 'string' || !/^\d{1,78}$/.test(value.amount)
    || typeof value.updatedAt !== 'number' || !Number.isSafeInteger(value.updatedAt)
    || value.updatedAt <= 0 || value.updatedAt > Date.now() + 60_000) return unavailable;
  const amount = BigInt(value.amount);
  if (amount >= 2n ** 256n) return unavailable;
  const block = record(value.verifiedBlock) && typeof value.verifiedBlock.hash === 'string' && /^0x[0-9a-f]{64}$/i.test(value.verifiedBlock.hash)
    && typeof value.verifiedBlock.stateRoot === 'string' && /^0x[0-9a-f]{64}$/i.test(value.verifiedBlock.stateRoot)
    && typeof value.verifiedBlock.number === 'string' && /^0x[0-9a-f]+$/i.test(value.verifiedBlock.number)
    && typeof value.verifiedBlock.timestamp === 'number' && value.verifiedBlock.timestamp > 0 && value.verifiedBlock.timestamp <= Date.now() + 60_000
    ? value.verifiedBlock as import('./verification/trust').VerifiedBlock : undefined;
  let estimate: Estimate | undefined;
  const price = value.estimate;
  if (block && record(price) && typeof price.pool === 'string' && isAddress(price.pool)
    && typeof price.quote === 'string' && isAddress(price.quote) && typeof price.symbol === 'string' && /^[a-zA-Z0-9._-]{1,16}$/.test(price.symbol)
    && typeof price.decimals === 'number' && Number.isInteger(price.decimals) && price.decimals >= 0 && price.decimals <= 255
    && typeof price.numerator === 'string' && /^[1-9][0-9]{0,200}$/.test(price.numerator)
    && typeof price.denominator === 'string' && /^[1-9][0-9]{0,200}$/.test(price.denominator)
    && typeof price.minLiquidity === 'string' && /^\d{1,24}(\.\d{1,18})?$/.test(price.minLiquidity)
    && price.blockHash === block.hash && price.window === WINDOW) estimate = price as Estimate;
  return { ...(failure ? { failure } : {}), estimate, amount, updatedAt: value.updatedAt, failed: value.failed === true, cached: true,
    ...(block ? { verifiedBlock: block } : {}),
    ...(typeof value.decimals === 'number' && Number.isInteger(value.decimals) && value.decimals >= 0 && value.decimals <= 255
      ? { decimals: value.decimals } : {}),
  };
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
      try { wallet.name = typeof entry.name === 'string' ? validateAddressName(entry.name) : undefined; }
      catch { /* A bad name must not discard a valid address or its balances. */ }
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
  return balance.amount === undefined ? (balance.failure ? { failed: true, failure: balance.failure } : undefined)
    : { amount: balance.amount.toString(), updatedAt: balance.updatedAt, failed: balance.failed, failure: balance.failure, verifiedBlock: balance.verifiedBlock, decimals: balance.decimals, estimate: balance.estimate };
}
export function savePortfolio(wallets: Wallet[], tokens: Token[]): boolean {
  try {
    localStorage.setItem(PORTFOLIO_KEY, JSON.stringify({
      version: 3, tokens,
      wallets: wallets.map(wallet => ({
        address: wallet.address, name: wallet.name,
        balances: Object.fromEntries(tokens.map(token => [token.address, savedBalance(tokenBalance(wallet, token))])),
      })),
    }));
    return true;
  } catch { return false; }
}
