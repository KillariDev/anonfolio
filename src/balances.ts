import { formatUnits, type Address } from 'viem';
import { verifyWallet } from './verification/client';
import type { VerifiedBlock } from './verification/trust';
import type { AnonRpcWorker } from '@anon-rpc/browser-harness';
import { WETH } from './config';
import { defaultTokens, type Token } from './tokens';

export type PrivateWorker = Pick<AnonRpcWorker, 'fetch'>;
export type Balance = { amount?: bigint; updatedAt?: number; failed: boolean; cached?: boolean; verifiedBlock?: VerifiedBlock; decimals?: number; decimalsVerified?: boolean };
export type RequestActivity = {
  asset: string;
  symbol: string;
  description: string;
  phase: 'waiting' | 'requesting' | 'received' | 'failed';
  attempt: number;
};
export type Wallet = {
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
  verificationStatus?: string;
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
export function prepareActivity(wallet: Wallet, tokens: Token[], onlyFailed = false) {
  wallet.activity = tokens.filter(token => !onlyFailed || tokenBalance(wallet, token).failed).map(token => ({
    asset: token.address, symbol: token.symbol,
    description: token.address === 'eth' ? 'eth_getProof(address) against a verified finalized state root'
      : 'Local EVM · balanceOf(address) on ' + token.address + ' · verified finalized block',
    phase: 'waiting', attempt: 0,
  }));
}
export async function readBalances(
  wallet: Wallet, worker: PrivateWorker, tokens: Token[] = defaultTokens(), onChange: () => void = () => {}, onlyFailed = false,
  verifier: typeof verifyWallet = verifyWallet,
) {
  const selected = tokens.filter(token => !onlyFailed || tokenBalance(wallet, token).failed || !tokenBalance(wallet, token).verifiedBlock);
  prepareActivity(wallet, selected);
  const pending = new Set(selected.map(token => token.address as string));
  try {
    await verifier(wallet, worker, selected, event => {
      if (event.type === 'progress') wallet.verificationStatus = event.message;
      const activity = wallet.activity.find(item => item.asset === event.asset);
      const token = selected.find(token => token.address === event.asset);
      if (event.type === 'asset' && activity) { activity.phase = 'requesting'; activity.attempt++; }
      if (event.type === 'balance' && token && event.block && event.amount !== undefined) {
        setTokenBalance(wallet, token, { amount: BigInt(event.amount), updatedAt: Date.now(), failed: false,
          verifiedBlock: event.block, decimals: event.decimals, decimalsVerified: event.decimalsVerified });
        if (activity) activity.phase = 'received';
        pending.delete(token.address);
      }
      if (event.type === 'asset-error' && token) {
        tokenBalance(wallet, token).failed = true;
        if (activity) activity.phase = 'failed';
        wallet.verificationStatus = event.error;
      }
      onChange();
    });
  } catch (error) { wallet.verificationStatus = String(error); }
  for (const token of selected) if (pending.has(token.address)) {
    tokenBalance(wallet, token).failed = true;
    const activity = wallet.activity.find(item => item.asset === token.address);
    if (activity) activity.phase = 'failed';
  }
  if (!pending.size && selected.length) wallet.verificationStatus = 'Verification complete: ' + selected.length + ' assets at one verified finalized block.';
  onChange();
}
export function formatBalance(amount: bigint, decimals = 18): string {
  if (amount < 0n) return '-' + formatBalance(-amount, decimals);
  if (decimals <= 2) return formatUnits(amount, decimals);
  const divisor = 10n ** BigInt(decimals - 2);
  if (amount > 0n && amount < divisor) return '<0.01';
  return formatUnits((amount + divisor / 2n) / divisor, 2);
}
