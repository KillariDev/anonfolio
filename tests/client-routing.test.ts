import { expect, test } from 'bun:test';
import { verifyWallet } from '../src/verification/client';
import { makeWallet } from '../src/balances';
import { ethToken } from '../src/tokens';
import { config } from '../src/config';
import { DEFAULT_CHECKPOINT } from '../src/verification/trust';
import { CONSENSUS_RPC } from '../src/verification/trust';

test('background consensus and wallet execution use separate private keys with no direct fetch fallback', async () => {
  const OriginalWorker = globalThis.Worker, originalFetch = globalThis.fetch;
  let fake: any;
  class BridgeWorker {
    onmessage: any; onerror: any; sent: any[] = [];
    constructor() { fake = this; }
    postMessage(data: any) { this.sent.push(data); }
    terminate() {}
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: BridgeWorker });
  globalThis.fetch = (() => { throw new Error('Direct network forbidden'); }) as unknown as typeof fetch;
  const calls: any[] = [];
  let fail = false;
  const privateWorker = { fetch: async (url: any, init: any) => {
    calls.push({ url, key: init.anonOptions.isolationKey, method: init.method });
    if (fail) throw new Error('Tor route unavailable');
    return init.method === 'GET' ? Response.json({ data: 'verified-by-Helios' }) : Response.json({ jsonrpc: '2.0', id: 1, result: '0x' });
  } };
  const wallet = makeWallet('0x0000000000000000000000000000000000000001', 'https://execution.example/');
  let session: Promise<void> | undefined;
  const originalCheckpoint = config.checkpoint;
  config.checkpoint = { root: '0x' + '22'.repeat(32), slot: DEFAULT_CHECKPOINT.slot };
  try {
    session = verifyWallet(wallet, privateWorker, [ethToken], () => {});
    const run = fake.sent[0].id;
    expect(fake.sent[0].checkpoint).toEqual(config.checkpoint);
    // No active run ID: consensus background sync must still use Anon-RPC.
    await fake.onmessage({ data: { type: 'consensus', id: 10, url: CONSENSUS_RPC + '/eth/v1/beacon/light_client/finality_update' } });
    expect(fake.sent.at(-1).type).toBe('consensus-reply');
    await fake.onmessage({ data: { type: 'rpc', run, id: 11, body: { jsonrpc: '2.0', id: 1, method: 'eth_getProof', params: [wallet.address, [], { blockHash: '0x'+'11'.repeat(32) }] } } });
    expect(calls[0].key).not.toBe(wallet.isolationKey); expect(calls[1].key).toBe(wallet.isolationKey);
    fail = true;
    await fake.onmessage({ data: { type: 'consensus', id: 12, url: CONSENSUS_RPC + '/eth/v1/beacon/light_client/finality_update' } });
    expect(fake.sent.at(-1).error).toContain('Tor route unavailable');
    expect(calls[2].key).toBe(calls[0].key);
    await fake.onmessage({ data: { type: 'consensus', id: 13, url: 'https://unexpected.example/eth/v1/beacon/genesis' } });
    expect(fake.sent.at(-1).error).toContain('Disallowed consensus'); expect(calls).toHaveLength(3);
    await fake.onmessage({ data: { type: 'done', run } }); await session;
  } finally {
    config.checkpoint = originalCheckpoint;
    fake?.onerror?.({ message: 'Test cleanup' });
    await session?.catch(() => {});
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: OriginalWorker });
    globalThis.fetch = originalFetch;
  }
});
