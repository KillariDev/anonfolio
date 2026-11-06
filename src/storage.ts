import { readFailure } from './errors';
import { WINDOW, type Estimate } from './pricing';
import { validateAddressName } from './addresses';
import { WETH, config } from './config';
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
function parsePortfolio(data: unknown, rpcUrls: string[]): { wallets: Wallet[]; tokens: Token[] } {
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
type Snapshot = { version: 3; tokens: Token[]; wallets: { address: Address; name?: string; balances: Record<string, ReturnType<typeof savedBalance>> }[] };
const baselines = new WeakMap<Wallet[], Snapshot>();
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
function snapshot(wallets: Wallet[], tokens: Token[]): Snapshot {
  // Remove undefined fields and detach the baseline from mutable UI objects.
  return JSON.parse(JSON.stringify({ version: 3, tokens, wallets: wallets.map(wallet => ({
    address: wallet.address, name: wallet.name,
    balances: Object.fromEntries(tokens.map(token => [token.address, savedBalance(tokenBalance(wallet, token))])),
  })) }));
}
function storedPortfolio(rpcUrls: string[]) {
  let data: unknown;
  try { data = JSON.parse(localStorage.getItem(PORTFOLIO_KEY) || 'null'); } catch { /* malformed/blocked cache uses migration defaults */ }
  return parsePortfolio(data, rpcUrls);
}
export function loadPortfolio(rpcUrls: string[]) {
  const portfolio = storedPortfolio(rpcUrls);
  baselines.set(portfolio.wallets, snapshot(portfolio.wallets, portfolio.tokens));
  return portfolio;
}
function mergeRecords<T extends { address: string }>(base: T[], local: T[], remote: T[], merge: (base: T | undefined, local: T, remote: T) => T): T[] {
  const previous = new Map(base.map(value => [value.address, value]));
  const current = new Map(local.map(value => [value.address, value]));
  const latest = new Map(remote.map(value => [value.address, value]));
  const result: T[] = [];
  for (const address of new Set([...latest.keys(), ...current.keys()])) {
    const before = previous.get(address), ours = current.get(address), theirs = latest.get(address);
    // A removal wins over a late refresh or metadata update in another tab.
    if (before && (!ours || !theirs)) continue;
    if (!ours) { if (theirs) result.push(theirs); continue; }
    if (!theirs || same(ours, theirs)) { result.push(ours); continue; }
    result.push(merge(before, ours, theirs));
  }
  return result;
}
function mergeSnapshots(base: Snapshot, local: Snapshot, remote: Snapshot): Snapshot {
  const choose = <T>(before: T | undefined, ours: T, theirs: T) => same(ours, before) ? theirs : ours;
  const tokens = mergeRecords(base.tokens, local.tokens, remote.tokens, (before, ours, theirs) => ({
    address: ours.address, symbol: choose(before?.symbol, ours.symbol, theirs.symbol),
    decimals: choose(before?.decimals, ours.decimals, theirs.decimals), icon: choose(before?.icon, ours.icon, theirs.icon),
  }));
  const wallets = mergeRecords(base.wallets, local.wallets, remote.wallets, (before, ours, theirs) => ({
    address: ours.address, name: choose(before?.name, ours.name, theirs.name),
    // Each amount, proof provenance and quote is one indivisible record.
    balances: Object.fromEntries(tokens.map(token => [token.address,
      choose(before?.balances[token.address], ours.balances[token.address], theirs.balances[token.address])])),
  }));
  return JSON.parse(JSON.stringify({ version: 3, tokens, wallets }));
}
function applySnapshot(wallets: Wallet[], tokens: Token[], merged: Snapshot, rpcUrls: string[]) {
  const parsed = parsePortfolio(merged, rpcUrls);
  const existing = new Map(wallets.map(wallet => [wallet.address, wallet]));
  const result = parsed.wallets.map(restored => {
    const wallet = existing.get(restored.address);
    if (!wallet) return restored;
    wallet.name = restored.name;
    for (const token of parsed.tokens) {
      const balance = tokenBalance(restored, token);
      // Keep live status, isolation keys, active requests and verified freshness
      // when the saved value itself has not changed.
      if (!same(savedBalance(tokenBalance(wallet, token)), savedBalance(balance))) setTokenBalance(wallet, token, balance);
    }
    for (const address of Object.keys(wallet.tokens)) if (!parsed.tokens.some(token => token.address === address)) delete wallet.tokens[address];
    return wallet;
  });
  wallets.splice(0, wallets.length, ...result);
  // Preserve token object identity for pending icon uploads and open settings.
  const existingTokens = new Map(tokens.map(token => [token.address, token]));
  tokens.splice(0, tokens.length, ...parsed.tokens.map(token => {
    const current = existingTokens.get(token.address);
    if (!current) return token;
    delete current.icon; Object.assign(current, token); return current;
  }));
}
export function syncPortfolio(wallets: Wallet[], tokens: Token[], rpcUrls = config.rpcUrls) {
  const remote = storedPortfolio(rpcUrls);
  const latest = snapshot(remote.wallets, remote.tokens);
  const local = snapshot(wallets, tokens);
  const merged = mergeSnapshots(baselines.get(wallets) || local, local, latest);
  applySnapshot(wallets, tokens, merged, rpcUrls);
  // Unsaved local edits remain a delta against the actual stored snapshot.
  baselines.set(wallets, latest);
}
// Browser callers serialize this read/merge/write transaction with Web Locks.
export function savePortfolio(wallets: Wallet[], tokens: Token[]): boolean {
  try {
    const local = snapshot(wallets, tokens);
    const baseline = baselines.get(wallets);
    const remote = storedPortfolio(config.rpcUrls);
    const merged = baseline ? mergeSnapshots(baseline, local, snapshot(remote.wallets, remote.tokens)) : local;
    localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(merged));
    applySnapshot(wallets, tokens, merged, config.rpcUrls);
    baselines.set(wallets, merged);
    return true;
  } catch { return false; }
}
