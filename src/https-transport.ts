import type { PrivateWorker } from './balances';
import { assertConsensusUrl } from './verification/transport';

// Available only after the user explicitly selects HTTPS. No Tor caller uses
// this capability as a fallback. Verification still limits every RPC method.
export function httpsTransport(rpcUrls: string[], fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch): PrivateWorker & { close(): void } {
  const endpoints = new Set(rpcUrls.map(url => new URL(url).href));
  const lifetime = new AbortController();
  return {
    transport: 'https',
    close: () => lifetime.abort(new Error('HTTPS connection closed.')),
    fetch: async (input, init) => {
      if (input instanceof Request) throw new Error('HTTPS transport requires an explicit URL and request options.');
      lifetime.signal.throwIfAborted();
      const url = new URL(String(input));
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Disallowed HTTPS destination.');
      if (init?.method === 'POST' && endpoints.has(url.href)) {
        if (typeof init.body !== 'string') throw new Error('Expected an explicit JSON-RPC request.');
        const body = JSON.parse(init.body);
        if (!body || Array.isArray(body) || body.jsonrpc !== '2.0' || !Array.isArray(body.params)
          || !['eth_getProof', 'eth_getCode', 'eth_getBlockByHash', 'eth_getBlockByNumber'].includes(body.method)) throw new Error('Disallowed HTTPS execution request.');
      } else {
        assertConsensusUrl(url.href);
        if (init?.method !== 'GET') throw new Error('Disallowed HTTPS consensus method.');
      }
      // Reconstruct options: isolation keys and arbitrary harness options must
      // never become headers or payloads in a direct request.
      return fetcher(url.href, { method: init.method, headers: init.headers, body: init.body,
        signal: init.signal ? AbortSignal.any([init.signal, lifetime.signal]) : lifetime.signal,
        credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' });
    },
  };
}
