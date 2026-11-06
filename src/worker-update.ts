import { readResponseBytes, readResponseJson } from './response-body';
import { decodeAbiParameters, keccak256 } from 'viem';
import { TOR_SPECIFIER } from './config';
import { WORKER_HASH_SELECTOR, WORKER_RESOLVERS_SELECTOR } from './bootstrap';
import { errorMessage } from './errors';
import { validateWorkerMetadata, type WorkerMetadata } from './worker-metadata';
export const WORKER_DISCOVERY_RPC = 'https://ethereum-rpc.publicnode.com/';
export const WORKER_DOWNLOAD_LIMIT = 20_000_000;
const CACHE = 'anonfolio-user-tor-worker-v1';
const cacheKey = (hash: string) => new URL('anonfolio-tor-worker/' + hash, document.baseURI).href;
type Progress = (message: string) => void;
// Deliberate Settings action only. This capability cannot submit wallet requests.
export async function discoverTorWorker(progress: Progress, fetcher: typeof fetch = fetch): Promise<WorkerMetadata> {
  let id = 0;
  async function rpc(method: 'eth_blockNumber' | 'eth_call', params: unknown[]) {
    const requestId = ++id;
    const signal = AbortSignal.timeout(30_000);
    const response = await fetcher(WORKER_DISCOVERY_RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }), credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal });
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error('PublicNode worker discovery returned HTTP ' + response.status); }
    const data = await readResponseJson(response, 256 * 1024, 'PublicNode worker discovery', signal);
    if (data.error) throw new Error('PublicNode worker discovery rejected: ' + errorMessage(data.error));
    if (data.jsonrpc !== '2.0' || data.id !== requestId || typeof data.result !== 'string') throw new Error('PublicNode returned invalid worker discovery data.');
    return data.result as `0x${string}`;
  }
  progress('Connecting directly to ethereum-rpc.publicnode.com: eth_blockNumber. No wallet addresses are sent.');
  const blockNumber = await rpc('eth_blockNumber', []);
  if (!/^0x[0-9a-f]+$/i.test(blockNumber)) throw new Error('PublicNode returned an invalid discovery block.');
  progress('Direct PublicNode eth_call: workerHash() on the Tor specifier at block ' + blockNumber + '.');
  const hash = await rpc('eth_call', [{ to: TOR_SPECIFIER, data: WORKER_HASH_SELECTOR }, blockNumber]);
  progress('Direct PublicNode eth_call: workerResolvers() on the same specifier and block.');
  const encoded = await rpc('eth_call', [{ to: TOR_SPECIFIER, data: WORKER_RESOLVERS_SELECTOR }, blockNumber]);
  const [resolvers] = decodeAbiParameters([{ type: 'string[]' }], encoded);
  // Resolver lists can mix transports. This manual downloader supports HTTPS;
  // KPS belongs to the harness and must not invalidate usable HTTPS mirrors.
  const httpsResolvers = resolvers.filter(resolver => /^https:/i.test(resolver));
  const skipped = resolvers.length - httpsResolvers.length;
  if (!httpsResolvers.length) throw new Error('The Tor specifier advertises no HTTPS worker download locations. This updater supports HTTPS downloads; KPS and other resolver types are skipped.');
  if (skipped) progress('Using ' + httpsResolvers.length + ' HTTPS worker download location(s); skipped ' + skipped + ' KPS or unsupported resolver entry/entries.');
  return validateWorkerMetadata({ hash, resolvers: httpsResolvers, blockNumber });
}
export async function cacheTorWorker(metadata: WorkerMetadata, progress: Progress, fetcher: typeof fetch = fetch) {
  const selected = validateWorkerMetadata(metadata);
  const errors: string[] = [];
  for (const url of selected.resolvers) {
    try {
      progress('Downloading Tor worker directly from ' + new URL(url).hostname + '; wallet requests are not sent to this host.');
      const signal = AbortSignal.timeout(90_000);
      const response = await fetcher(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal });
      if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error('HTTP ' + response.status); }
      const bytes = await readResponseBytes(response, WORKER_DOWNLOAD_LIMIT, 'Tor worker', signal);
      progress('Checking the downloaded Tor worker against the discovered Keccak-256 digest.');
      if (keccak256(new Uint8Array(bytes)) !== selected.hash) throw new Error('Tor worker digest mismatch.');
      const cache = await caches.open(CACHE);
      await cache.put(cacheKey(selected.hash), new Response(bytes, { headers: { 'content-type': 'text/javascript' } }));
      return;
    } catch (error) { errors.push(new URL(url).hostname + ': ' + errorMessage(error)); }
  }
  throw new Error('Tor worker update could not be downloaded and saved. ' + errors.join(' · '));
}
export async function cachedTorWorkerUrl(metadata: WorkerMetadata) {
  const selected = validateWorkerMetadata(metadata);
  const response = await (await caches.open(CACHE)).match(cacheKey(selected.hash));
  if (!response) throw new Error('Saved Tor worker bundle is unavailable. Update it again in Settings → Tor worker, or select the bundled worker.');
  const bytes = await readResponseBytes(response, WORKER_DOWNLOAD_LIMIT, 'Saved Tor worker');
  if (keccak256(new Uint8Array(bytes)) !== selected.hash) throw new Error('Saved Tor worker digest mismatch. Update it again in Settings → Tor worker, or select the bundled worker.');
  return URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
}
