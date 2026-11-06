import { test, expect } from '@playwright/test';
import { keccak256 } from 'viem';

test('verified bytecode persists across browser worker restarts without a network fetch',async({page})=>{
  test.skip(!!process.env.BASE_URL || !!process.env.IPFS_GATEWAY_URL,'Development verifier module harness.');
  await page.route('**/bytecode-cache-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Bytecode cache test</title>'}));
  await page.route('**/bytecode-cache-test-worker.js',route=>route.fulfill({contentType:'text/javascript',body:`
    import { VerifiedCodeCache } from '/src/verification/code-cache.ts';
    self.onmessage=async({data})=>{
      self.fetch=()=>{throw new Error('Ordinary fetch forbidden');};
      try {
        let downloads=0;
        const result=await new VerifiedCodeCache().load(data.hash,async()=>{
          downloads++;
          if(!data.allowDownload)throw new Error('Unexpected code download');
          return data.code;
        });
        self.postMessage({...result,downloads});
      }catch(error){self.postMessage({error:String(error)});}
    };
  `}));
  await page.goto('/bytecode-cache-test');
  const code='0x60005460005260206000f3';const hash=keccak256(code);
  const run=async(allowDownload:boolean)=>page.evaluate(({code,hash,allowDownload})=>new Promise<any>((resolve,reject)=>{
    const worker=new Worker('/bytecode-cache-test-worker.js',{type:'module'});
    worker.onmessage=event=>{worker.terminate();resolve(event.data);};
    worker.onerror=event=>{worker.terminate();reject(new Error(event.message));};
    worker.postMessage({code,hash,allowDownload});
  }),{code,hash,allowDownload});
  expect(await run(true)).toEqual({code,source:'RPC',downloads:1});
  await page.reload();
  expect(await run(false)).toEqual({code,source:'browser cache',downloads:0});
  // Persisted bytes are never trusted merely because they were cached earlier.
  await page.evaluate(async hash=>{
    const cache=await caches.open('anonfolio-verified-bytecode-v1');
    const key=(await cache.keys()).find(key=>key.url.endsWith(hash));
    if(!key)throw new Error('Missing persisted code');
    await cache.put(key,new Response('0x1234'));
  },hash);
  expect(await run(true)).toEqual({code,source:'RPC',downloads:1});
  expect(await run(false)).toEqual({code,source:'browser cache',downloads:0});
});
