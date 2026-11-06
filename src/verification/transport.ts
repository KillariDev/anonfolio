import { readResponseJson, readResponseText } from '../response-body';
import { withDeadline } from '../deadline';
import { errorMessage } from '../errors';
import { CONSENSUS_RPC } from './trust';
import type { PrivateWorker, Wallet } from '../balances';
export type RpcRequest = { jsonrpc: '2.0'; id: number | string; method: string; params: any[] };
export const transportName = (worker: PrivateWorker) => worker.transport === 'https' ? 'Direct HTTPS' : 'Private';
export const transportRoute = (worker: PrivateWorker) => worker.transport === 'https' ? 'direct HTTPS' : 'Anon-RPC';
export class ProofHistoryUnavailable extends Error {}
// Generous enough for block bodies, proof witnesses and beacon updates, but finite.
export const EXECUTION_RESPONSE_LIMIT = 16 * 1024 * 1024;
export const CONSENSUS_RESPONSE_LIMIT = 16 * 1024 * 1024;
const methods = new Set(['eth_getProof', 'eth_getCode', 'eth_getBlockByHash', 'eth_getBlockByNumber']);
// Execution uses the explicitly selected capability. Tor never falls back to HTTPS.
export async function privateExecutionRpc(worker: PrivateWorker, wallet: Pick<Wallet, 'rpcUrl' | 'isolationKey'>, request: RpcRequest, signal?: AbortSignal, progress?: (state: 'waiting' | 'reading' | 'received') => void) {
  if (!request || Array.isArray(request) || !methods.has(request.method) || !Array.isArray(request.params)) throw new Error('Disallowed execution request.');
  const label = transportName(worker);
  return withDeadline(async privateSignal => {
    const response = await worker.fetch(wallet.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
      signal: privateSignal, anonOptions: { isolationKey: wallet.isolationKey } }).catch(error => {
      throw new Error(label + ' ' + request.method + ' to ' + new URL(wallet.rpcUrl).hostname + ' failed: ' + errorMessage(error));
    });
    progress?.('reading');
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error(label + ' RPC returned HTTP ' + response.status); }
    const data = await readResponseJson(response, EXECUTION_RESPONSE_LIMIT, label + ' RPC', privateSignal).catch(error => {
      throw new Error(label + ' ' + request.method + ' response from ' + new URL(wallet.rpcUrl).hostname + ' could not be read: ' + errorMessage(error));
    });
    progress?.('received');
    if (data?.error && data.id === request.id && data.jsonrpc === '2.0') {
      const reason = typeof data.error.message === 'string' ? data.error.message.slice(0, 300) : 'request rejected';
      const message = label + ' ' + request.method + ' to ' + new URL(wallet.rpcUrl).hostname + ' rejected (' + String(data.error.code) + '): ' + reason;
      if (request.method === 'eth_getProof' && Number.isInteger(data.error.code) && /maximum proof window|proof window|historical.*proof|missing trie node|historical state.*unavailable|state.*pruned/i.test(reason)) throw new ProofHistoryUnavailable(message);
      throw new Error(message);
    }
    if (!data || data.id !== request.id || data.jsonrpc !== '2.0' || !('result' in data)) throw new Error(label + ' RPC response is unavailable or invalid.');
    return data;
  }, 90_000, label + ' ' + request.method + ' to ' + new URL(wallet.rpcUrl).hostname + ' timed out after 90 seconds.', signal);
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
export async function privateConsensusGet(worker: PrivateWorker, isolationKey: string, value: string, signal?: AbortSignal, progress?: (state: 'waiting' | 'reading' | 'received') => void) {
  const url = assertConsensusUrl(value);
  return withDeadline(async privateSignal => {
    const response = await worker.fetch(url.href, { method: 'GET', headers: { accept: 'application/json' },
      signal: privateSignal, anonOptions: { isolationKey } }).catch(error => {
      throw new Error('Consensus GET ' + url.hostname + url.pathname + ' through ' + transportRoute(worker) + ' failed: ' + errorMessage(error));
    });
    progress?.('reading');
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error('Consensus GET ' + url.hostname + url.pathname + ' returned HTTP ' + response.status); }
    const body = await readResponseText(response, CONSENSUS_RESPONSE_LIMIT, 'Consensus API', privateSignal).catch(error => {
      throw new Error('Consensus GET ' + url.hostname + url.pathname + ' response could not be read: ' + errorMessage(error));
    });
    progress?.('received');
    return { status: response.status, body };
  }, 90_000, 'Consensus GET ' + url.hostname + url.pathname + ' timed out after 90 seconds.', signal);
}
