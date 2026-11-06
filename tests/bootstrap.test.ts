import { expect, test } from 'bun:test';
import { decodeAbiParameters, keccak256 } from 'viem';
import { pinnedSpecifierProvider, WORKER_HASH_SELECTOR, WORKER_RESOLVERS_SELECTOR } from '../src/bootstrap';
import { TOR_SPECIFIER, TOR_WORKER_HASH } from '../src/config';

test('worker metadata comes only from source pins and the local bundle, without network access', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error('Direct network access forbidden'); }) as unknown as typeof fetch;
  try {
    const provider = pinnedSpecifierProvider('https://app.example/ipfs/CID/assets/anon-rpc-worker.js');
    const params = (data: string) => [{ to: TOR_SPECIFIER, data }, 'latest'];
    expect(await provider.request({ method: 'eth_call', params: params(WORKER_HASH_SELECTOR) })).toBe(TOR_WORKER_HASH);
    const resolvers = await provider.request({ method: 'eth_call', params: params(WORKER_RESOLVERS_SELECTOR) });
    expect(decodeAbiParameters([{ type: 'string[]' }], resolvers)).toEqual([['https://app.example/ipfs/CID/assets/anon-rpc-worker.js']]);
    for (const request of [
      { method: 'eth_getCode', params: [TOR_SPECIFIER, 'latest'] },
      { method: 'eth_call', params: params('0x70a08231') },
      { method: 'eth_call', params: [{ to: '0x0000000000000000000000000000000000000001', data: WORKER_HASH_SELECTOR }, 'latest'] },
      { method: 'eth_call', params: [{ to: TOR_SPECIFIER, data: WORKER_HASH_SELECTOR }, 'pending'] },
    ]) await expect(provider.request(request)).rejects.toThrow();
  } finally { globalThis.fetch = original; }
});
test('vendored Tor bundle bytes match the independently pinned worker digest', async () => {
  const bytes = new Uint8Array(await Bun.file(new URL('../vendor/tor/anon-rpc-worker.js', import.meta.url)).arrayBuffer());
  expect(keccak256(bytes)).toBe(TOR_WORKER_HASH);
});
