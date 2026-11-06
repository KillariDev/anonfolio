import { expect, test } from 'bun:test';
import { Trie } from '@ethereumjs/trie';
import { bytesToHex, hexToBytes, keccak256, toRlp, type Hex } from 'viem';
import bundled from '../src/verification/bytecode/mainnet.json';
import { VerifiedCodeCache, type CodeStore } from '../src/verification/code-cache';
import { executionCode } from '../src/verification/execution-code';
import { privateExecutionRpc, type RpcRequest } from '../src/verification/transport';

const address = '0x0000000000000000000000000000000000000001' as Hex;
const other = '0x0000000000000000000000000000000000000002' as Hex;
const code = '0x60005460005260206000f3' as Hex;
function store() {
  const entries = new Map<Hex,string>();
  return { entries, async get(hash: Hex) { return entries.get(hash); }, async put(hash: Hex,value: Hex) { entries.set(hash,value); } };
}
async function fixture(bytes: Hex = code, who = address) {
  const empty = keccak256(toRlp('0x'));
  const trie = new Trie({ useKeyHashing:true });
  await trie.put(hexToBytes(who),hexToBytes(toRlp(['0x','0x',empty,keccak256(bytes)])));
  const block = {hash:'0x'+'11'.repeat(32),number:'0x100',timestamp:Date.now(),stateRoot:bytesToHex(trie.root())};
  const proof = {address:who,nonce:'0x0',balance:'0x0',storageHash:empty,codeHash:keccak256(bytes),accountProof:(await trie.createProof(hexToBytes(who))).map(value=>bytesToHex(value)),storageProof:[]};
  const body: RpcRequest = {jsonrpc:'2.0',id:7,method:'eth_getCode',params:[who,{blockHash:block.hash}]};
  return {block,proof,body};
}
const noDownload = async () => { throw new Error('Unexpected code download'); };

test('every bundled runtime is content-addressed and avoids a download only after a genuine account proof',async()=>{
  for(const entry of bundled) {
    expect(keccak256(entry.code as Hex)).toBe(entry.hash as Hex);
    const {body,block,proof}=await fixture(entry.code as Hex);
    const calls:string[]=[];
    const result=await executionCode(body,block,new Map(),async request=>{calls.push(request.method); if(request.method!=='eth_getProof')throw new Error('No bytecode download expected'); return {result:proof};},new VerifiedCodeCache(store()));
    expect(result).toEqual({code:entry.code as Hex,source:'bundled code'});
    expect(calls).toEqual(['eth_getProof']);
  }
});

test('verified custom code persists across verifier instances and accounts; memory reuse does not download again',async()=>{
  const saved=store(); let downloads=0;
  const first=new VerifiedCodeCache(saved,[]);
  expect((await first.load(keccak256(code),async()=>{downloads++;return code;})).source).toBe('RPC');
  expect((await first.load(keccak256(code),noDownload)).source).toBe('memory cache');
  const second=new VerifiedCodeCache(saved,[]);
  for(const who of [other,address]) {
    const {body,block,proof}=await fixture(code,who);
    const calls:string[]=[];
    const result=await executionCode(body,block,new Map(),async request=>{calls.push(request.method);return {result:proof};},second);
    expect(result.code).toBe(code); expect(calls).toEqual(['eth_getProof']);
  }
  expect(downloads).toBe(1);
});

test('cached code never bypasses a fresh account proof, wrong wallet, or pinned block',async()=>{
  const {body,block,proof}=await fixture();
  const cache=new VerifiedCodeCache(store(),[{hash:keccak256(code),code}]);
  await expect(executionCode(body,block,new Map(),async()=>({result:{...proof,address:other}}),cache)).rejects.toThrow('different requested address');
  await expect(executionCode(body,{...block,stateRoot:'0x'+'22'.repeat(32)},new Map(),async()=>({result:proof}),cache)).rejects.toThrow();
  await expect(executionCode({...body,params:[address,'latest']},block,new Map(),noDownload,cache)).rejects.toThrow('pinned finalized block');
  await expect(executionCode(body,block,new Map(),async()=>{throw new Error('Tor unavailable');},cache)).rejects.toThrow('Tor unavailable');
});

test('a changed implementation hash downloads new code and never reuses the old address code',async()=>{
  const saved=store(); const oldHash=keccak256(code);
  saved.entries.set(oldHash,code);
  const updated='0x600160005260206000f3' as Hex;
  const {body,block,proof}=await fixture(updated);
  const calls:string[]=[];
  const result=await executionCode(body,block,new Map(),async request=>{calls.push(request.method);return {result:request.method==='eth_getProof'?proof:updated};},new VerifiedCodeCache(saved,[]));
  expect(result.code).toBe(updated); expect(calls).toEqual(['eth_getProof','eth_getCode']);
  expect(saved.entries.get(keccak256(updated))).toBe(updated);
  expect(saved.entries.get(oldHash)).toBe(code);
});

test('corrupt bundled/persisted code is ignored, tampered network code is rejected and never saved',async()=>{
  const saved=store();const hash=keccak256(code);
  saved.entries.set(hash,'0x1234');
  const cache=new VerifiedCodeCache(saved,[{hash,code:'0x5678'}]);
  await expect(cache.load(hash,async()=> '0xaaaa')).rejects.toThrow('Bytecode hash');
  expect(saved.entries.get(hash)).toBe('0x1234');
  expect((await cache.load(hash,async()=>code)).code).toBe(code);
  expect(saved.entries.get(hash)).toBe(code);
  await expect(new VerifiedCodeCache(store(),[]).load(hash,async()=> '0x'+'00'.repeat(65537))).rejects.toThrow('oversized');
});

test('disabled browser storage does not prevent verified downloads, and simultaneous code requests share one download',async()=>{
  const disabled:CodeStore={get:async()=>{throw new Error('disabled');},put:async()=>{throw new Error('quota');}};
  const cache=new VerifiedCodeCache(disabled,[]);let downloads=0;
  const results=await Promise.all(Array.from({length:5},()=>cache.load(keccak256(code),async()=>{downloads++;await Promise.resolve();return code;})));
  expect(downloads).toBe(1); expect(results.every(result=>result.code===code)).toBe(true);
});

test('new code and all required proofs use the wallet private route, with no ordinary fetch or cross-wallet request',async()=>{
  const {body,block,proof}=await fixture();const calls:any[]=[];const original=globalThis.fetch;
  globalThis.fetch=(()=>{throw new Error('Ordinary fetch forbidden');}) as unknown as typeof fetch;
  try {
    const worker={fetch:async(url:any,init:any)=>{const request=JSON.parse(init.body);calls.push({url,key:init.anonOptions.isolationKey,request});return Response.json({jsonrpc:'2.0',id:request.id,result:request.method==='eth_getProof'?proof:code});}};
    const cache=new VerifiedCodeCache(store(),[]);
    for(const isolationKey of ['wallet-one','wallet-two']) {
      await executionCode(body,block,new Map(),request=>privateExecutionRpc(worker,{rpcUrl:'https://private.example/',isolationKey},request),cache);
    }
    expect(calls.map(call=>[call.request.method,call.key])).toEqual([['eth_getProof','wallet-one'],['eth_getCode','wallet-one'],['eth_getProof','wallet-two']]);
    expect(calls.every(call=>!Array.isArray(call.request))).toBe(true);
  } finally {globalThis.fetch=original;}
});
