import { CONSENSUS_RPC } from './trust';
import type { PrivateWorker, Wallet } from '../balances';
export type RpcRequest = { jsonrpc: '2.0'; id: number | string; method: string; params: any[] };
const methods = new Set(['eth_getProof', 'eth_getCode', 'eth_getBlockByHash', 'eth_getBlockByNumber']);
// The only execution-network capability. No ordinary fetch or public fallback.
export async function privateExecutionRpc(worker: PrivateWorker, wallet: Pick<Wallet, 'rpcUrl' | 'isolationKey'>, request: RpcRequest) {
  if (!request || Array.isArray(request) || !methods.has(request.method) || !Array.isArray(request.params)) throw new Error('Disallowed execution request.');
  const response = await worker.fetch(wallet.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
    signal: AbortSignal.timeout(90_000), anonOptions: { isolationKey: wallet.isolationKey } });
  if (!response.ok) throw new Error('Private RPC returned HTTP ' + response.status);
  const data = await response.json();
  if (data?.error && data.id === request.id && data.jsonrpc === '2.0') {
    const reason = typeof data.error.message === 'string' ? data.error.message.slice(0, 300) : 'request rejected';
    throw new Error('Private ' + request.method + ' rejected (' + String(data.error.code) + '): ' + reason);
  }
  if (!data || data.id !== request.id || data.jsonrpc !== '2.0' || !('result' in data)) throw new Error('Private RPC response is unavailable or invalid.');
  return data;
}

export function assertConsensusUrl(value: string) {
  const url = new URL(value);
  if (url.origin !== CONSENSUS_RPC || url.username || url.password || url.hash
    || !/^\/eth\/v[12]\/(beacon\/(light_client\/|blocks\/|genesis$)|config\/spec$)/.test(url.pathname)) {
    throw new Error('Disallowed consensus request.');
  }
  return url;
}
// Consensus shares one route of its own, never a wallet isolation key. It must
// work during background light-client sync, outside any active wallet session.
export async function privateConsensusGet(worker: PrivateWorker, isolationKey: string, value: string) {
  const url = assertConsensusUrl(value);
  const response = await worker.fetch(url.href, { method: 'GET', headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(90_000), anonOptions: { isolationKey } });
  if (!response.ok) throw new Error('Consensus GET ' + url.hostname + url.pathname + ' returned HTTP ' + response.status);
  return { status: response.status, body: await response.text() };
}
