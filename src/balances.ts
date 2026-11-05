import { createPublicClient, erc20Abi, formatUnits, http, type Address } from 'viem';
import { mainnet } from 'viem/chains';
import type { AnonRpcWorker } from '@anon-rpc/browser-harness';
import { WETH } from './config';

export type PrivateWorker = Pick<AnonRpcWorker, 'fetch'>;
export type Balance = { amount?: bigint; updatedAt?: number; failed: boolean };
export type Wallet = {
  address: Address;
  isolationKey: string;
  rpcUrl: string;
  eth: Balance;
  weth: Balance;
  loading: boolean;
};
export function makeWallet(address: Address, rpcUrl: string): Wallet {
  return { address, rpcUrl, isolationKey: crypto.randomUUID(),
    eth: { failed: false }, weth: { failed: false }, loading: false };
}
export function privateClient(wallet: Wallet, worker: PrivateWorker) {
  // There is exactly one HTTP transport per wallet. No fallback and no batches.
  const fetchFn = (input: RequestInfo | URL, init?: RequestInit) => worker.fetch(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    { ...init, anonOptions: { isolationKey: wallet.isolationKey } },
  );
  return createPublicClient({
    chain: mainnet,
    ccipRead: false,
    batch: { multicall: false },
    transport: http(wallet.rpcUrl, { fetchFn, batch: false, retryCount: 1, retryDelay: 1000, timeout: 90_000 }),
  });
}
export async function readBalances(wallet: Wallet, worker: PrivateWorker) {
  const client = privateClient(wallet, worker);
  const results = await Promise.allSettled([
    client.getBalance({ address: wallet.address, blockTag: 'latest' }),
    client.readContract({ address: WETH, abi: erc20Abi, functionName: 'balanceOf',
      args: [wallet.address], blockTag: 'latest' }),
  ]);
  for (const [index, key] of (['eth', 'weth'] as const).entries()) {
    const result = results[index]!;
    if (result.status === 'fulfilled') {
      wallet[key] = { amount: result.value, updatedAt: Date.now(), failed: false };
    } else {
      wallet[key].failed = true;
    }
  }
}
export const formatBalance = (amount: bigint) => formatUnits(amount, 18);
