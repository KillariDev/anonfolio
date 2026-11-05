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
    terminated = false;
    terminate() { this.terminated = true; }
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
    const rejection = session.catch(error => error);
    await fake.onmessage({ data: { type: 'consensus', id: 12, url: CONSENSUS_RPC + '/eth/v1/beacon/light_client/finality_update' } });
    expect((await rejection).message).toContain('Tor route unavailable');
    expect(fake.terminated).toBe(true);
    expect(calls[2].key).toBe(calls[0].key);
  } finally {
    config.checkpoint = originalCheckpoint;
    fake?.onerror?.({ message: 'Test cleanup' });
    await session?.catch(() => {});
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: OriginalWorker });
    globalThis.fetch = originalFetch;
  }
});

test('queued wallets have no active timer; failure starts the next job and late messages cannot finish it', async () => {
  const OriginalWorker = globalThis.Worker, originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const workers: any[] = [], timers: { callback: () => void; cleared?: boolean }[] = [];
  class BridgeWorker {
    onmessage: any; onerror: any; sent: any[] = []; terminated = false;
    constructor() { workers.push(this); }
    postMessage(data: any) { this.sent.push(data); }
    terminate() { this.terminated = true; }
  }
  Object.defineProperty(globalThis, 'Worker', { configurable:true, value:BridgeWorker });
  globalThis.setTimeout = ((callback: () => void, delay: number, ...args: any[]) => {
    if (delay !== 300_000) return originalSet(callback, delay, ...args);
    const timer = { callback }; timers.push(timer); return timer;
  }) as any;
  globalThis.clearTimeout = ((id: any) => { if (timers.includes(id)) id.cleared = true; else originalClear(id); }) as any;
  const worker = { fetch: async () => Response.json({}) };
  const a = makeWallet('0x0000000000000000000000000000000000000001','https://execution.example/');
  const b = makeWallet('0x0000000000000000000000000000000000000002','https://execution.example/');
  const events: string[] = [];
  let first: Promise<void> | undefined, second: Promise<void> | undefined;
  try {
    first = verifyWallet(a,worker,[ethToken],()=>{});
    second = verifyWallet(b,worker,[ethToken],event=>events.push(event.type));
    expect(workers).toHaveLength(1); expect(timers).toHaveLength(1); expect(events).toEqual(['queued']);
    const id = workers[0].sent[0].id;
    const rejected = first.catch(error=>error);
    await workers[0].onmessage({data:{type:'fatal',run:id,error:'Private read failed'}}); expect((await rejected).message).toContain('Private read failed');
    await Promise.resolve();
    expect(workers[0].terminated).toBe(true); expect(timers[0]!.cleared).toBe(true);
    expect(workers).toHaveLength(2); expect(events).toEqual(['queued','started']);
    await workers[0].onmessage({data:{type:'done',run:id}});
    expect(workers[1].terminated).toBe(false);
    const nextId = workers[1].sent[0].id;
    await workers[1].onmessage({data:{type:'price-start',run:nextId,asset:'eth'}});
    const expired = second.catch(error=>error);
    timers[1]!.callback(); expect((await expired).message).toContain('Verification timed out');
    expect(workers[1].terminated).toBe(true); expect(timers[1]!.cleared).toBe(true);
    expect(events).toContain('price-error');
    const third = verifyWallet(a,worker,[ethToken],()=>{}).catch(error=>error);
    const last = workers[2];
    await last.onmessage({data:{type:'asset-error',run:last.sent[0].id,asset:'eth',error:'Contract read failed'}});
    expect((await third).message).toContain('All balance reads failed');
    expect(last.terminated).toBe(true); expect(timers[2]!.cleared).toBe(true);
  } finally {
    workers.at(-1)?.onerror?.({message:'Cleanup'});
    await first?.catch(()=>{}); await second?.catch(()=>{});
    globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear;
    Object.defineProperty(globalThis,'Worker',{configurable:true,value:OriginalWorker});
  }
});
