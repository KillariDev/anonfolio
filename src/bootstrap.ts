import { encodeAbiParameters, toFunctionSelector } from 'viem';
import { TOR_SPECIFIER, TOR_WORKER_HASH } from './config';

export const WORKER_HASH_SELECTOR = toFunctionSelector('workerHash()');
export const WORKER_RESOLVERS_SELECTOR = toFunctionSelector('workerResolvers()');
// The harness expects a specifier provider. Supply reviewed release metadata
// locally, rather than querying Ethereum before the Tor worker exists.
export function pinnedSpecifierProvider(bundleUrl: string, hash: `0x${string}` = TOR_WORKER_HASH) {
  return { request: async ({ method, params }: { method: string; params?: unknown }) => {
    if (method !== 'eth_call' || !Array.isArray(params) || params.length !== 2 || params[1] !== 'latest') throw new Error('Network specifier discovery is disabled.');
    const call = params[0] as { to?: unknown; data?: unknown } | null;
    if (!call || typeof call.to !== 'string' || call.to.toLowerCase() !== TOR_SPECIFIER.toLowerCase()) throw new Error('Unrecognized worker specifier.');
    if (call.data === WORKER_HASH_SELECTOR) return hash;
    if (call.data === WORKER_RESOLVERS_SELECTOR) return encodeAbiParameters([{ type: 'string[]' }], [[bundleUrl]]);
    throw new Error('Only pinned worker metadata is available; no RPC fallback.');
  } };
}
