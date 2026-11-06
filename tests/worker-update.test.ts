import { expect, test } from 'bun:test';
import { encodeAbiParameters } from 'viem';
import { discoverTorWorker, WORKER_DISCOVERY_RPC } from '../src/worker-update';
import { validateWorkerMetadata } from '../src/worker-metadata';
import { TOR_SPECIFIER, TOR_WORKER_HASH } from '../src/config';
import { WORKER_HASH_SELECTOR, WORKER_RESOLVERS_SELECTOR, pinnedSpecifierProvider } from '../src/bootstrap';
const metadata = { hash: TOR_WORKER_HASH, blockNumber: '0x123', resolvers: ['https://worker.example/bundle.js'] };

test('manual worker discovery sends only specifier reads at one block, never wallet data', async () => {
  const requests: any[] = [];
  const progress: string[] = [];
  const fetcher = (async (url: any, init: any) => {
    expect(url).toBe(WORKER_DISCOVERY_RPC);
    const body = JSON.parse(init.body); requests.push(body);
    return Response.json({ jsonrpc: '2.0', id: body.id, result: body.method === 'eth_blockNumber' ? '0x123'
      : body.params[0].data === WORKER_HASH_SELECTOR ? TOR_WORKER_HASH
      : encodeAbiParameters([{ type: 'string[]' }], [metadata.resolvers]) });
  }) as typeof fetch;
  expect(await discoverTorWorker(message => progress.push(message), fetcher)).toEqual(metadata);
  expect(requests.map(request => request.method)).toEqual(['eth_blockNumber', 'eth_call', 'eth_call']);
  expect(requests.slice(1).map(request => request.params)).toEqual([
    [{ to: TOR_SPECIFIER, data: WORKER_HASH_SELECTOR }, '0x123'],
    [{ to: TOR_SPECIFIER, data: WORKER_RESOLVERS_SELECTOR }, '0x123'],
  ]);
  expect(progress[0]).toContain('directly');
});
test('manual discovery reports HTTP/RPC errors and rejects unsafe or incomplete metadata', async () => {
  await expect(discoverTorWorker(() => {}, (async () => new Response('', { status: 503 })) as unknown as typeof fetch)).rejects.toThrow('HTTP 503');
  await expect(discoverTorWorker(() => {}, (async () => Response.json({ error: { message: 'Rate limit', code: 429 } })) as unknown as typeof fetch)).rejects.toThrow('Rate limit (429)');
  for (const value of [null, {}, { ...metadata, hash: '0x123' }, { ...metadata, resolvers: [] },
    ...['http://worker.example/', 'javascript:alert(1)', 'https://user:secret@worker.example/', 'https://worker.example/#x'].map(url => ({ ...metadata, resolvers: [url] }))]) {
    expect(() => validateWorkerMetadata(value)).toThrow();
  }
});
test('a user-selected digest is supplied locally to the harness with no network discovery', async () => {
  const hash = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
  const provider = pinnedSpecifierProvider('blob:https://app.example/saved-worker', hash);
  expect(await provider.request({ method: 'eth_call', params: [{ to: TOR_SPECIFIER, data: WORKER_HASH_SELECTOR }, 'latest'] })).toBe(hash);
});

test('mixed on-chain resolver transports keep HTTPS mirrors and skip KPS without executing it', async () => {
  const kps = 'kps:152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ/keccak/5b/worker';
  const mirrors = ['https://cdn.jsdelivr.net/npm/tor-js@0.4.4/dist/anon-rpc-worker.js', 'https://unpkg.com/tor-js@0.4.4/dist/anon-rpc-worker.js'];
  for (const advertised of [[...mirrors, kps], [kps, ...mirrors], [...mirrors, 'http://unsupported.example/worker.js']]) {
    const progress: string[] = [];
    const fetcher = (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      return Response.json({ jsonrpc:'2.0', id:body.id, result:body.method==='eth_blockNumber'?'0x123'
        :body.params[0].data===WORKER_HASH_SELECTOR?TOR_WORKER_HASH:encodeAbiParameters([{type:'string[]'}],[advertised]) });
    }) as typeof fetch;
    expect(await discoverTorWorker(message => progress.push(message),fetcher)).toEqual({...metadata,resolvers:mirrors});
    expect(progress.at(-1)).toContain('skipped 1 KPS or unsupported');
  }
});
test('KPS-only discovery explains the unsupported transport and unsafe HTTPS metadata stays rejected', async () => {
  for (const [resolvers,reason] of [
    [['kps:gateway.example:123:hash/worker'],'no HTTPS worker download locations'],
    [['https://user:secret@worker.example/','kps:gateway.example:123:hash/worker'],'without credentials or fragments'],
  ] as const) {
    const fetcher=(async(_url:any,init:any)=>{const body=JSON.parse(init.body);return Response.json({jsonrpc:'2.0',id:body.id,result:body.method==='eth_blockNumber'?'0x123':body.params[0].data===WORKER_HASH_SELECTOR?TOR_WORKER_HASH:encodeAbiParameters([{type:'string[]'}],[resolvers])});}) as typeof fetch;
    await expect(discoverTorWorker(()=>{},fetcher)).rejects.toThrow(reason);
  }
});
