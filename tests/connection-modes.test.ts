import { explainFailure, readFailure } from '../src/errors';
import { expect, test } from 'bun:test';
import { httpsTransport } from '../src/https-transport';
import { privateExecutionRpc, privateConsensusGet } from '../src/verification/transport';
import { CONSENSUS_RPC } from '../src/verification/trust';
import { validateSettings } from '../src/settings';
const endpoint = 'https://eth.drpc.org/';
const gateway = '152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ';

test('HTTPS is explicit and settings preserve Tor for legacy users', () => {
  const settings = { gateways: [gateway], rpcUrls: [endpoint] };
  expect(validateSettings(settings).mode).toBeUndefined();
  expect(validateSettings({...settings, mode:'https'}).mode).toBe('https');
  for (const mode of ['auto','fallback','',null]) expect(()=>validateSettings({...settings,mode})).toThrow();
  for (const bootstrapUrl of ['http://mirror.example/a.json','https://user:secret@mirror.example/a.json','//elsewhere/a.json','../wallet.json']) expect(()=>validateSettings({...settings,bootstrapUrl})).toThrow();
});
test('HTTPS capability strips private options and allows only configured execution and consensus', async () => {
  const calls: {url:string;init:RequestInit}[]=[];
  const worker=httpsTransport([endpoint],async(input,init)=>{
    calls.push({url:String(input),init:init!});
    return init?.method==='POST'?Response.json({jsonrpc:'2.0',id:1,result:{}}):Response.json({data:{}});
  });
  const body={jsonrpc:'2.0' as const,id:1,method:'eth_getProof',params:['0x'+'11'.repeat(20),[],'0x123']};
  await privateExecutionRpc(worker,{rpcUrl:endpoint,isolationKey:'secret-wallet-key'},body);
  await privateConsensusGet(worker,'secret-consensus-key',CONSENSUS_RPC+'/eth/v1/beacon/light_client/updates?start_period=1&count=1');
  expect(calls).toHaveLength(2);
  expect(calls[0]!.init.credentials).toBe('omit');
  expect(calls[0]!.init.referrerPolicy).toBe('no-referrer');
  expect(calls[0]!.init.redirect).toBe('error');
  expect(calls[0]!.init.cache).toBe('no-store');
  expect(calls[0]!.init).not.toHaveProperty('anonOptions');
  expect(JSON.stringify(calls)).not.toContain('secret-wallet-key');
  for(const [url,init] of [
    ['https://other.example/',{method:'POST',body:JSON.stringify(body)}],
    [endpoint,{method:'POST',body:JSON.stringify([body])}],
    [endpoint,{method:'POST',body:JSON.stringify({...body,method:'eth_call'})}],
    [endpoint,{method:'GET'}],
    [CONSENSUS_RPC+'/other',{method:'GET'}],
    [CONSENSUS_RPC+'/eth/v1/beacon/genesis',{method:'POST'}],
  ] as const) await expect(worker.fetch(url,init)).rejects.toThrow();
  expect(calls).toHaveLength(2);
  worker.close();
  await expect(worker.fetch(endpoint,{method:'POST',body:JSON.stringify(body)})).rejects.toThrow();
});
test('HTTPS errors identify the actual transport and never create a Tor worker', async()=>{
  const worker=httpsTransport([endpoint],async()=>{throw new Error('provider unreachable');});
  await expect(privateExecutionRpc(worker,{rpcUrl:endpoint,isolationKey:'wallet-key'},
    {jsonrpc:'2.0',id:1,method:'eth_getCode',params:[]})).rejects.toThrow('Direct HTTPS eth_getCode to eth.drpc.org failed: provider unreachable');
});

test('HTTPS recovery advice identifies HTTPS/CORS rather than Tor gateways',()=>{
  for (const message of ['Direct HTTPS eth_getProof failed: Failed to fetch','Direct HTTPS RPC returned HTTP 403','Direct HTTPS request timed out']) {
    const failure=explainFailure(readFailure(message),'https');
    expect(failure.action).toContain('CORS');
    expect(failure.action).not.toContain('Tor');
  }
});
