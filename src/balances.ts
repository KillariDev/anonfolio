import { createPublicClient, erc20Abi, formatUnits, http, type Address } from 'viem';
import { mainnet } from 'viem/chains';
import type { AnonRpcWorker } from '@anon-rpc/browser-harness';
import { WETH } from './config';
import { wethToken, type Token } from './tokens';

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
  if (token.address === WETH) return wallet.weth;
  return wallet.tokens[token.address] ??= { failed: false };
}
export function prepareActivity(wallet: Wallet, tokens: Token[]) {
  wallet.activity = [
    { asset: 'eth', symbol: 'ETH', description: 'eth_getBalance(address, latest)', phase: 'waiting', attempt: 0 },
    ...[wethToken, ...tokens].map(token => ({
      asset: token.address, symbol: token.symbol,
      description: 'eth_call · balanceOf(address) on ' + token.address + ' · latest',
      phase: 'waiting' as const, attempt: 0,
    })),
  ];
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
  wallet: Wallet, worker: PrivateWorker, tokens: Token[] = [], onChange: () => void = () => {},
) {
  prepareActivity(wallet, tokens);
  const client = privateClient(wallet, worker, onChange);
  const jobs = [
    { asset: 'eth', balance: () => wallet.eth, set: (value: Balance) => { wallet.eth = value; },
      read: () => client.getBalance({ address: wallet.address, blockTag: 'latest' }) },
    ...[wethToken, ...tokens].map(token => ({
      asset: token.address, balance: () => tokenBalance(wallet, token),
      set: (value: Balance) => {
        if (token.address === WETH) wallet.weth = value;
        else wallet.tokens[token.address] = value;
      },
      read: () => client.readContract({ address: token.address, abi: erc20Abi, functionName: 'balanceOf',
        args: [wallet.address], blockTag: 'latest' }),
    })),
  ];
  await Promise.all(jobs.map(async job => {
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
export const formatBalance = (amount: bigint, decimals = 18) => formatUnits(amount, decimals);
