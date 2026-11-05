import { expect,test } from 'bun:test';
import { operatorRoute,executionWithOperators } from '../src/verification/operators';
import { type RpcRequest } from '../src/verification/transport';
const first='https://short.example/',second='https://history.example/';
const request:RpcRequest={jsonrpc:'2.0',id:1,method:'eth_getProof',params:['0x0000000000000000000000000000000000000001',['0x1'],{blockHash:'0x'+'11'.repeat(32)}]};
const rejected=()=>Response.json({jsonrpc:'2.0',id:1,error:{code:-32602,message:'distance to target block exceeds maximum proof window'}});
const accepted=()=>Response.json({jsonrpc:'2.0',id:1,result:{accountProof:[],storageProof:[]}});
test('proof-window failover uses only configured private operators with identical wallet key, body and block',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=(()=>{throw new Error('Direct fetch forbidden');}) as any;
  try {
    const calls:any[]=[],switched:string[]=[],progress:any[]=[];
    const worker={fetch:async(url:any,init:any)=>{calls.push({url,key:init.anonOptions.isolationKey,body:init.body});return url===first?rejected():accepted();}};
    const route=operatorRoute(first,[first,second]);
    await executionWithOperators(worker,route,'wallet-key',request,new AbortController().signal,(url,state)=>progress.push({url,state}),(from,to)=>switched.push(from+' → '+to));
    expect(calls.map(call=>call.url)).toEqual([first,second]);
    expect(calls.every(call=>call.key==='wallet-key'&&call.body===JSON.stringify(request))).toBe(true);
    expect(switched).toEqual([first+' → '+second]);
    expect(progress.filter(event=>event.state==='waiting').map(event=>event.url)).toEqual([first,second]);
    // Later code/storage requests use the selected endpoint, without reprobing the short one.
    await executionWithOperators(worker,route,'wallet-key',{...request,method:'eth_getCode'},new AbortController().signal,()=>{},()=>{});
    expect(calls.map(call=>call.url)).toEqual([first,second,second]);
  } finally { globalThis.fetch=original; }
});
test('concurrent balance/oracle window failures converge without looping or changing their block',async()=>{
  const route=operatorRoute(first,[first,second]),calls:any[]=[];
  let release!:()=>void; const wait=new Promise<void>(resolve=>{release=resolve;});
  const worker={fetch:async(url:any,init:any)=>{calls.push({url,body:init.body,key:init.anonOptions.isolationKey});if(url===first){await wait;return rejected();}return accepted();}};
  const reads=[1,2].map(()=>executionWithOperators(worker,route,'same-wallet',request,new AbortController().signal,()=>{},()=>{}));
  await Promise.resolve(); release(); await Promise.all(reads);
  expect(calls.map(call=>call.url)).toEqual([first,first,second,second]);
  expect(calls.every(call=>call.key==='same-wallet'&&call.body===JSON.stringify(request))).toBe(true);
});
test('exhausted proof-history endpoints fail closed; other failures never trigger an operator switch',async()=>{
  const route=operatorRoute(first,[second]),calls:string[]=[];
  const noHistory={fetch:async(url:any)=>{calls.push(url);return rejected();}};
  await expect(executionWithOperators(noHistory,route,'key',request,new AbortController().signal,()=>{},()=>{})).rejects.toThrow('No configured RPC can serve');
  expect(calls).toEqual([first,second]);
  for(const outcome of ['timeout','malformed','malformed error','invalid params','rate limit']) {
    const calls:string[]=[];
    const worker={fetch:async(url:any)=>{calls.push(url);if(outcome==='timeout')throw new Error('Tor unavailable');if(outcome==='malformed')return Response.json({bad:true});if(outcome==='malformed error')return Response.json({jsonrpc:'2.0',id:1,error:{message:'distance to target block exceeds maximum proof window'}});if(outcome==='rate limit')return new Response('',{status:429});return Response.json({jsonrpc:'2.0',id:1,error:{code:-32602,message:'Invalid params'}});}};
    await expect(executionWithOperators(worker,operatorRoute(first,[second]),'key',request,new AbortController().signal,()=>{},()=>{})).rejects.toThrow();
    expect(calls).toEqual([first]);
  }
});
test('a cancelled attempt cannot send a fallback request',async()=>{
  const controller=new AbortController(),calls:string[]=[];
  const worker={fetch:async(url:any)=>{calls.push(url);controller.abort(new Error('Cancelled'));return rejected();}};
  await expect(executionWithOperators(worker,operatorRoute(first,[second]),'key',request,controller.signal,()=>{},()=>{})).rejects.toThrow('Cancelled');
  expect(calls).toEqual([first]);
});
