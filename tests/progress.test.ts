import { expect, test } from 'bun:test';
import { progressTime, waitingReason } from '../src/verification/progress';
import { privateExecutionRpc } from '../src/verification/transport';

test('elapsed clocks show a bounded deadline, without inventing completion percentages', () => {
  expect(progressTime(1_000, 13_000, 91_000)).toBe('12s elapsed · request timeout in 78s');
  expect(progressTime(1_000, 99_000, 91_000)).toBe('98s elapsed · request timeout in 0s');
  expect(progressTime(1_000, 0)).toBe('0s elapsed');
  expect(waitingReason('consensus')).toContain('balance request not sent');
  expect(waitingReason('queued')).toBe('Queued for the verifier');
});

test('private transport distinguishes response headers from completion of the body', async () => {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { body = controller; } });
  const phases: string[] = [];
  const result = privateExecutionRpc({ fetch: async () => new Response(stream) },
    { rpcUrl: 'https://rpc.example', isolationKey: 'wallet-private-key' },
    { jsonrpc:'2.0', id:1, method:'eth_getProof', params:[] }, undefined, phase => phases.push(phase));
  await Bun.sleep(0);
  expect(phases).toEqual(['reading']);
  body.enqueue(new TextEncoder().encode(JSON.stringify({ jsonrpc:'2.0', id:1, result:{} })));
  body.close();
  await result;
  expect(phases).toEqual(['reading','received']);
});

test('request purposes distinguish accounts, storage, bytecode and independent pricing targets', async()=>{
  const {RequestPurposes}=await import('../src/verification/request-purpose');
  const {defaultTokens}=await import('../src/tokens');
  const {defaultPricing,V3_FACTORY,WETH_USDC_POOL}=await import('../src/pricing');
  const wallet='0x0000000000000000000000000000000000000001';
  const tokens=defaultTokens(),purposes=new RequestPurposes(wallet,tokens,defaultPricing());
  const describe=(method:string,target:string,slots:string[]=[])=>purposes.describe({jsonrpc:'2.0',id:1,method,params:[target,slots]});
  expect(describe('eth_getProof',wallet).purpose).toBe('Tracked address account proof');
  expect(describe('eth_getCode',tokens[1]!.address).purpose).toBe('WETH bytecode');
  expect(describe('eth_getProof',tokens[1]!.address,['0x01','0x02']).purpose).toBe('WETH storage proof · 2 slots');
  expect(describe('eth_getProof',V3_FACTORY,['0x01']).purpose).toBe('Uniswap factory storage proof · 1 slot');
  expect(describe('eth_getCode',WETH_USDC_POOL).purpose).toBe('WETH/USDC pool bytecode');
  const pool='0x'+'ab'.repeat(20),dependency='0x'+'cd'.repeat(20);
  purposes.name(pool,'TOKEN/USDC pool');
  expect(describe('eth_getCode',pool).purpose).toBe('TOKEN/USDC pool bytecode');
  expect(describe('eth_getProof',tokens[1]!.address,['0x01']).purpose).toBe('WETH storage proof · 1 slot');
  expect(describe('eth_getCode',dependency)).toEqual({target:dependency,purpose:'Contract 0xcdcd…cdcd bytecode'});
  const hash='0x'+'ab'.repeat(32);
  const header=(method:string,target:string)=>purposes.describe({jsonrpc:'2.0',id:1,method,params:[target,false]}).purpose;
  expect(header('eth_getBlockByNumber','0x1922bba')).toBe('Block header #26356666');
  expect(header('eth_getBlockByNumber','finalized')).toBe('Block header finalized');
  expect(header('eth_getBlockByHash',hash)).toBe('Block header 0xabababab…abab');
  purposes.rememberConsensus({data:[{data:{finalized_header:{execution:{block_hash:hash,block_number:'26356666'}}}}]});
  expect(header('eth_getBlockByHash',hash)).toBe('Block header #26356666');
  expect(header('eth_getBlockByHash','0x'+'cd'.repeat(32))).toBe('Block header 0xcdcdcdcd…cdcd');
  purposes.rememberBlock(hash,'invalid');
  expect(header('eth_getBlockByHash',hash)).toBe('Block header #26356666');
});

test('consensus labels retain concise checkpoint and update identifiers',async()=>{
  const {consensusPurpose}=await import('../src/verification/request-purpose');
  const base='https://consensus.example/eth/v1/beacon/light_client/';
  expect(consensusPurpose(base+'updates?start_period=1487&count=2')).toBe('Consensus updates · period 1487 × 2');
  expect(consensusPurpose(base+'bootstrap/0x'+'ab'.repeat(32))).toBe('Consensus bootstrap 0xabababab…abab');
  expect(consensusPurpose(base+'finality_update')).toBe('Consensus finality update');
});
