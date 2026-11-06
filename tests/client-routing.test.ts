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
    const events: any[] = [];
    session = verifyWallet(wallet, privateWorker, [ethToken], event => events.push(event));
    const run = fake.sent[0].id;
    expect(fake.sent[0].checkpoint).toEqual(config.checkpoint);
    // No active run ID: consensus background sync must still use Anon-RPC.
    await fake.onmessage({ data: { type: 'consensus', id: 10, url: CONSENSUS_RPC + '/eth/v1/beacon/light_client/finality_update' } });
    expect(fake.sent.at(-1).type).toBe('consensus-reply');
    expect(events.filter(event=>event.type === 'network')).toHaveLength(0);
    await fake.onmessage({data:{type:'progress',run,stage:'consensus',message:'Syncing consensus'}});
    await fake.onmessage({data:{type:'consensus',id:13,url:CONSENSUS_RPC+'/eth/v1/beacon/light_client/updates?start_period=1&count=1'}});
    expect(events.filter(event=>event.type === 'network').map(event=>event.request.state)).toEqual(['waiting','reading','received']);
    expect(events.find(event=>event.type === 'network').request).toMatchObject({method:'GET eth/v1/beacon/light_client/updates',host:'ethereum-beacon-api.publicnode.com'});
    events.length=0;
    await fake.onmessage({ data: { type: 'rpc', run, id: 11, body: { jsonrpc: '2.0', id: 1, method: 'eth_getProof', params: [wallet.address, [], { blockHash: '0x'+'11'.repeat(32) }] } } });
    expect(events.filter(event=>event.type === 'network').map(event=>event.request.state)).toEqual(['waiting','reading','received']);
    expect(events.find(event=>event.type === 'network').request).toMatchObject({method:'eth_getProof',host:'execution.example'});
    expect(calls[0].key).not.toBe(wallet.isolationKey); expect(calls[2].key).toBe(wallet.isolationKey);
    fail = true;
    const rejection = session.catch(error => error);
    await fake.onmessage({ data: { type: 'consensus', id: 12, url: CONSENSUS_RPC + '/eth/v1/beacon/light_client/finality_update' } });
    expect((await rejection).message).toContain('Tor route unavailable');
    expect(fake.terminated).toBe(true);
    expect(calls[3].key).toBe(calls[0].key);
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

test('overlapping balance and oracle requests stay on the wallet route and cancel together', async () => {
  const OriginalWorker = globalThis.Worker;
  let fake: any;
  class BridgeWorker {
    onmessage: any; onerror: any; sent: any[]=[]; terminated=false;
    constructor() { fake=this; }
    postMessage(data: any) { this.sent.push(data); }
    terminate() { this.terminated=true; }
  }
  Object.defineProperty(globalThis,'Worker',{configurable:true,value:BridgeWorker});
  const calls: any[] = [], events: any[] = [];
  const privateWorker = { fetch: async (_url:any,init:any) => {
    calls.push(init);
    return await new Promise<Response>((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
  }};
  const wallet=makeWallet('0x0000000000000000000000000000000000000001','https://execution.example/');
  let result: Promise<any> | undefined;
  try {
    result=verifyWallet(wallet,privateWorker,[ethToken],event=>events.push(event)).catch(error=>error);
    const run=fake.sent[0].id;
    await fake.onmessage({data:{type:'progress',run,stage:'balances-pricing'}});
    await fake.onmessage({data:{type:'price-start',run,asset:'eth',stage:'balances-pricing'}});
    const balance=fake.onmessage({data:{type:'rpc',run,id:1,body:{jsonrpc:'2.0',id:1,method:'eth_getProof',params:[wallet.address,[],{blockHash:'0x'+'11'.repeat(32)}]}}});
    const price=fake.onmessage({data:{type:'rpc',run,id:2,body:{jsonrpc:'2.0',id:2,method:'eth_getProof',params:['0x1F98431c8aD98523631AE4a59f267346ea31F984',[],{blockHash:'0x'+'11'.repeat(32)}]}}});
    await Promise.resolve();
    expect(calls).toHaveLength(2);
    expect(calls.every(init=>init.anonOptions.isolationKey===wallet.isolationKey)).toBe(true);
    expect(events.filter(event=>event.type==='network').map(event=>event.request.requestId)).toEqual([1,2]);
    await fake.onmessage({data:{type:'fatal',run,error:'Invalid storage proof'}});
    await Promise.all([balance,price]);
    expect((await result).message).toContain('Invalid storage proof');
    expect(calls.every(init=>init.signal.aborted)).toBe(true);
    expect(events.filter(event=>event.type==='price-error')).toMatchObject([{asset:'eth',error:'Invalid storage proof'}]);
    expect(fake.terminated).toBe(true);
  } finally {
    fake?.onerror?.({message:'Cleanup'}); await result;
    Object.defineProperty(globalThis,'Worker',{configurable:true,value:OriginalWorker});
  }
});

test('cancellation removes queued sessions, aborts active RPCs and ignores late messages', async () => {
  const OriginalWorker = globalThis.Worker;
  const workers: any[] = [], requests: RequestInit[] = [];
  class BridgeWorker {
    sent: any[] = []; onmessage: any; onerror: any; terminated = false;
    constructor() { workers.push(this); }
    postMessage(message: any) { this.sent.push(message); }
    terminate() { this.terminated = true; }
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: BridgeWorker });
  const privateWorker = { fetch: async (_url: any, init: any) => {
    requests.push(init);
    return new Promise<Response>((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  } };
  const a = makeWallet('0x0000000000000000000000000000000000000001', 'https://execution.example/');
  const b = makeWallet('0x0000000000000000000000000000000000000002', 'https://execution.example/');
  const first = new AbortController(), second = new AbortController();
  let activeResult: Promise<any> | undefined, queuedResult: Promise<any> | undefined;
  try {
    activeResult = verifyWallet(a, privateWorker, [ethToken], () => {}, undefined, first.signal).catch(error => error);
    queuedResult = verifyWallet(b, privateWorker, [ethToken], () => {}, undefined, second.signal).catch(error => error);
    second.abort();
    expect((await queuedResult).message).toContain('cancelled');
    expect(workers[0].terminated).toBe(false);
    const run = workers[0].sent[0].id;
    const pendingRpc = workers[0].onmessage({ data: { type: 'rpc', run, id: 1,
      body: { jsonrpc: '2.0', id: 1, method: 'eth_getProof', params: [a.address, [], { blockHash: '0x' + '11'.repeat(32) }] } } });
    await Promise.resolve();
    expect(requests).toHaveLength(1);
    first.abort();
    expect((await activeResult).message).toContain('cancelled');
    await pendingRpc;
    expect(requests[0]!.signal!.aborted).toBe(true);
    expect(workers[0].terminated).toBe(true);
    await workers[0].onmessage({ data: { type: 'done', run } });
    expect(workers[0].sent.filter((message: any) => message.type === 'refresh')).toHaveLength(1);
    expect(workers).toHaveLength(1);
    const cancelled = new AbortController(); cancelled.abort();
    await expect(verifyWallet(b, privateWorker, [ethToken], () => {}, undefined, cancelled.signal)).rejects.toThrow();
    expect(workers).toHaveLength(1);
  } finally {
    first.abort(); second.abort(); await activeResult; await queuedResult;
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: OriginalWorker });
  }
});
