import { createPublicClient, erc20Abi, formatUnits, http, type Address } from 'viem';
import { mainnet } from 'viem/chains';
import type { AnonRpcWorker } from '@anon-rpc/browser-harness';
import { WETH } from './config';
import { defaultTokens, type Token } from './tokens';

export type PrivateWorker = Pick<AnonRpcWorker, 'fetch'>;
export type Balance = { amount?: bigint; updatedAt?: number; failed: boolean; cached?: boolean };
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
    description: token.address === 'eth' ? 'eth_getBalance(address, latest)'
      : 'eth_call · balanceOf(address) on ' + token.address + ' · latest',
    phase: 'waiting', attempt: 0,
  }));
}
export function privateClient(wallet: Wallet, worker: PrivateWorker, onChange: () => void = () => {}) {
  // Every attempt, including viem retries, goes through this wallet's worker route.
  const fetchFn = (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    const asset = body.method === 'eth_getBalance' ? 'eth' : body.params?.[0]?.to;
    const activity = wallet.activity.find(item => item.asset.toLowerCase() === String(asset).toLowerCase());
    if (activity) {
      activity.attempt++;
      activity.phase = 'requesting';
      onChange();
    }
    return worker.fetch(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      { ...init, anonOptions: { isolationKey: wallet.isolationKey } },
    );
  };
  return createPublicClient({
    chain: mainnet, ccipRead: false, batch: { multicall: false },
    transport: http(wallet.rpcUrl, { fetchFn, batch: false, retryCount: 1, retryDelay: 1000, timeout: 90_000 }),
  });
}
export async function readBalances(
  wallet: Wallet, worker: PrivateWorker, tokens: Token[] = defaultTokens(), onChange: () => void = () => {}, onlyFailed = false,
) {
  prepareActivity(wallet, tokens, onlyFailed);
  const client = privateClient(wallet, worker, onChange);
  const jobs = tokens.map(token => ({
    asset: token.address, balance: () => tokenBalance(wallet, token),
    set: (value: Balance) => setTokenBalance(wallet, token, value),
    read: () => token.address === 'eth'
      ? client.getBalance({ address: wallet.address, blockTag: 'latest' })
      : client.readContract({ address: token.address, abi: erc20Abi, functionName: 'balanceOf',
        args: [wallet.address], blockTag: 'latest' }),
  }));
  await Promise.all(jobs.filter(job => !onlyFailed || job.balance().failed).map(async job => {
    const activity = wallet.activity.find(item => item.asset === job.asset);
    try {
      const amount = await job.read();
      job.set({ amount, updatedAt: Date.now(), failed: false });
      if (activity) activity.phase = 'received';
    } catch {
      job.balance().failed = true;
      if (activity) activity.phase = 'failed';
    }
    onChange();
  }));
}
export function formatBalance(amount: bigint, decimals = 18): string {
  if (amount < 0n) return '-' + formatBalance(-amount, decimals);
  if (decimals <= 2) return formatUnits(amount, decimals);
  const divisor = 10n ** BigInt(decimals - 2);
  if (amount > 0n && amount < divisor) return '<0.01';
  return formatUnits((amount + divisor / 2n) / divisor, 2);
}
