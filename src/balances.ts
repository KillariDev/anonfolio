import { appendRetrievalLog, logVerificationEvent, type RetrievalLog } from './retrieval-log';
import type { CheckProgress, NetworkProgress, VerificationStage } from './verification/progress';
import { formatUnits, type Address } from 'viem';
import { errorMessage, readFailure, type ReadFailure } from './errors';
import { verifyWallet, type VerificationEvent } from './verification/client';
import type { VerifiedBlock } from './verification/trust';
import type { AnonRpcWorker } from '@anon-rpc/browser-harness';
import { loadPricing, priceFailure, retryPrice, type Estimate, type PriceFailure, type PricingSettings } from './pricing';
import { olderBalance } from './balance-freshness';
import { WETH } from './config';
import { defaultTokens, type Token } from './tokens';

export type PrivateWorker = Pick<AnonRpcWorker, 'fetch'> & { transport?: 'tor' | 'https' };
export type Balance = { failure?: ReadFailure; estimate?: Estimate; priceError?: string; priceFailure?: PriceFailure; amount?: bigint; updatedAt?: number; failed: boolean; cached?: boolean; verifiedBlock?: VerifiedBlock; decimals?: number };
export type RequestActivity = {
  asset: string;
  symbol: string;
  description: string;
  phase: 'waiting' | 'requesting' | 'received' | 'failed';
  attempt: number;
};
export type Wallet = RetrievalLog & {
  address: Address;
  name?: string;
  isolationKey: string;
  rpcUrl: string;
  eth: Balance;
  weth: Balance;
  tokens: Record<string, Balance>;
  activity: RequestActivity[];
  loading: boolean;
  queuedRefresh?: boolean;
  queuedForVerifier?: boolean;
  verificationStatus?: string;
  checkProgress?: CheckProgress;
  verificationStage?: VerificationStage;
  stageStartedAt?: number;
  networkRequests?: NetworkProgress[];
};
export function makeWallet(address: Address, rpcUrl: string): Wallet {
  return { address, rpcUrl, isolationKey: crypto.randomUUID(),
    eth: { failed: false }, weth: { failed: false }, tokens: {}, activity: [], loading: false };
}
export function tokenBalance(wallet: Wallet, token: Token): Balance {
  if (token.address === 'eth') return wallet.eth;
  if (token.address === WETH) return wallet.weth;
  return wallet.tokens[token.address] ??= { failed: false };
}
export function setTokenBalance(wallet: Wallet, token: Token, balance: Balance) {
  if (token.address === 'eth') wallet.eth = balance;
  else if (token.address === WETH) wallet.weth = balance;
  else wallet.tokens[token.address] = balance;
}
export function prepareActivity(wallet: Wallet, tokens: Token[], onlyFailed = false, pricing = loadPricing()) {
  wallet.activity = tokens.filter(token => !onlyFailed || tokenBalance(wallet, token).failed || retryPrice(tokenBalance(wallet, token), pricing)).map(token => ({
    asset: token.address, symbol: token.symbol,
    description: token.address === 'eth' ? 'eth_getProof(address) against a verified finalized state root'
      : 'Local EVM · balanceOf(address) on ' + token.address + ' · verified finalized block',
    phase: 'waiting', attempt: 0,
  }));
}
export async function readBalances(
  wallet: Wallet, worker: PrivateWorker, tokens: Token[] = defaultTokens(), onChange: () => void = () => {}, onlyFailed = false,
  verifier: typeof verifyWallet = verifyWallet, signal?: AbortSignal, pricing: PricingSettings = loadPricing(),
) {
  // Freeze the settings used by this request, including while the wallet queues.
  pricing = structuredClone(pricing);
  const selected = tokens.filter(token => !onlyFailed || tokenBalance(wallet, token).failed || !tokenBalance(wallet, token).verifiedBlock || retryPrice(tokenBalance(wallet, token), pricing));
  prepareActivity(wallet, selected);
  wallet.verificationStatus = 'Starting balance verification.';
  appendRetrievalLog(wallet,wallet.verificationStatus);
  wallet.networkRequests = [];
  wallet.queuedForVerifier = false;
  wallet.checkProgress = { completed: 0, total: selected.length * 2 };
  const finishedChecks = new Set<string>();
  const pending = new Set(selected.map(token => token.address as string));
  const reported = new Set<string>();
  const earlyPrices = new Map<string, VerificationEvent>();
  const finishedPrices = new Set<string>();
  const failPrice = (token: Token, error: unknown) => {
    const balance = tokenBalance(wallet, token);
    balance.priceFailure = priceFailure(error, pricing);
    balance.priceError = balance.priceFailure.message;
  };
  let fatal: ReadFailure | undefined;
  try {
    signal?.throwIfAborted();
    await verifier(wallet, worker, selected, event => {
      if (signal?.aborted) return;
      if (selected.some(token => token.address === event.asset) && (event.type === 'balance' ? Boolean(event.block && event.amount !== undefined) : ['asset-error','price','price-error'].includes(event.type))) {
        const kind = event.type === 'balance' || event.type === 'asset-error' ? 'balance' : 'price';
        finishedChecks.add(kind + ':' + event.asset);
        wallet.checkProgress = { completed: finishedChecks.size, total: selected.length * 2 };
      }
      logVerificationEvent(wallet,event,selected,worker.transport,wallet.checkProgress);
      const stage = event.stage || (event.type === 'queued' ? 'queued' : event.type === 'started' ? 'verifier' : event.type === 'asset' ? 'balances' : event.type === 'price-start' ? 'pricing' : undefined);
      if (stage && stage !== wallet.verificationStage) { wallet.verificationStage = stage; wallet.stageStartedAt = Date.now(); }
      if (event.type === 'network' && event.request) {
        wallet.networkRequests = (wallet.networkRequests || []).filter(request => request.requestId !== event.request!.requestId);
        if (event.request.state !== 'received') wallet.networkRequests.push(event.request);
      }
      if (event.type === 'queued' || event.type === 'started') {
        wallet.queuedForVerifier = event.type === 'queued';
        wallet.verificationStatus = event.message;
      }
      if (event.type === 'progress') wallet.verificationStatus = event.message ? errorMessage(event.message) : undefined;
      const activity = wallet.activity.find(item => item.asset === event.asset);
      const token = selected.find(token => token.address === event.asset);
      if (token && (event.type === 'price' || event.type === 'price-error')) finishedPrices.add(token.address);
      if (event.type === 'asset' && activity) { activity.phase = 'requesting'; activity.attempt++; }
      if (event.type === 'balance' && token && event.block && event.amount !== undefined) {
        const next = { amount: BigInt(event.amount), updatedAt: Date.now(), failed: false, verifiedBlock: event.block, decimals: token.decimals };
        if (!olderBalance(next, tokenBalance(wallet, token))) setTokenBalance(wallet, token, next);
        else appendRetrievalLog(wallet, token.symbol + ': kept the newer verified balance received from another refresh.');
        if (activity) activity.phase = 'received';
        pending.delete(token.address);
        const early = earlyPrices.get(token.address);
        if (early?.type === 'price' && early.block?.hash === tokenBalance(wallet, token).verifiedBlock?.hash) tokenBalance(wallet, token).estimate = early.estimate;
        if (early?.type === 'price-error') failPrice(token, early.error);
        earlyPrices.delete(token.address);
      }
      if ((event.type === 'price' || event.type === 'price-error') && token && pending.has(token.address)) earlyPrices.set(token.address, event);
      if (event.type === 'price' && token && !pending.has(token.address) && event.estimate && event.block?.hash === tokenBalance(wallet, token).verifiedBlock?.hash) {
        tokenBalance(wallet, token).estimate = event.estimate;
        tokenBalance(wallet, token).priceError = undefined;
        tokenBalance(wallet, token).priceFailure = undefined;
      }
      if (event.type === 'price-error' && token && !pending.has(token.address)) failPrice(token, event.error);
      if (event.type === 'asset-error' && token) {
        tokenBalance(wallet, token).failed = true;
        tokenBalance(wallet, token).failure = readFailure(event.error, event.message || wallet.verificationStatus);
        reported.add(token.address);
        if (activity) activity.phase = 'failed';
        wallet.verificationStatus = tokenBalance(wallet, token).failure!.message;
      }
      onChange();
    }, pricing, signal);
  } catch (error) { if (signal?.aborted) return; fatal = readFailure(error, wallet.verificationStatus); wallet.verificationStatus = fatal.message; appendRetrievalLog(wallet, 'Verification stopped: '+fatal.message, 'error'); }
  if (signal?.aborted) return;
  wallet.queuedForVerifier = false;
  wallet.networkRequests = [];
  for (const token of selected) if (pending.has(token.address)) {
    tokenBalance(wallet, token).failed = true;
    if (!reported.has(token.address)) tokenBalance(wallet, token).failure = fatal || readFailure('Verifier finished without returning a verified balance.', wallet.verificationStatus);
    const activity = wallet.activity.find(item => item.asset === token.address);
    if (activity) activity.phase = 'failed';
  }
  if (fatal) for (const token of selected) if (!pending.has(token.address) && !finishedPrices.has(token.address)) failPrice(token, fatal.message);
  if (!pending.size && selected.length) wallet.verificationStatus = 'Verification complete: ' + selected.length + ' assets at one verified finalized block.';
  appendRetrievalLog(wallet, fatal ? 'Refresh stopped; already proved balances are retained.' : pending.size ? 'Refresh ended without a proven result for '+pending.size+' assets.' : wallet.verificationStatus || 'Verification finished.', fatal || pending.size ? 'error' : 'success');
  onChange();
}
export function formatBalance(amount: bigint, decimals = 18): string {
  if (amount < 0n) return '-' + formatBalance(-amount, decimals);
  if (decimals <= 2) return formatUnits(amount, decimals);
  const divisor = 10n ** BigInt(decimals - 2);
  if (amount > 0n && amount < divisor) return '<0.01';
  return formatUnits((amount + divisor / 2n) / divisor, 2);
}
