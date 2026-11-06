import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { openWalletDetails, mockVerification } from './helpers';
const address='0x0000000000000000000000000000000000000001';
const gateway='152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ';
const harness='**/node_modules/.vite/deps/@anon-rpc_browser-harness.js*';
test.beforeEach(()=>test.skip(!!process.env.BASE_URL||!!process.env.IPFS_GATEWAY_URL,'Development module boundaries.'));
async function pausedTor(page:Page) {
  await page.route('**/tor-bootstrap.json',route=>route.fulfill({status:404,body:'No mirror'}));
  await page.route(harness,route=>route.fulfill({contentType:'text/javascript',body:`
    window.__torWorkers=[];
    export class AnonRpcWorker {
      constructor(init){this.init=init;this.closed=false;window.__torWorkers.push(this);this.ready=new Promise(resolve=>{this.resolve=resolve;});}
      close(){this.closed=true;}
      acceptLog(){return new Promise(()=>{});}
      fetch(_,init){const body=JSON.parse(init.body);return Promise.resolve(Response.json({jsonrpc:'2.0',id:body.id,result:'0x'+'0'.repeat(64)}));}
    }
  `}));
}
test('slow startup preserves the same worker and gateway pool, then succeeds after 30 seconds',async({page})=>{
  await page.clock.install();
  await pausedTor(page);await mockVerification(page);
  await page.addInitScript(gateway=>localStorage.setItem('anonfolio.network.v1',JSON.stringify({gateways:[gateway,gateway.replace(':12298:',':12299:')],rpcUrls:['https://eth.drpc.org/']})),gateway);
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>(window as any).__torWorkers.length)).toBe(1);
  await page.clock.fastForward(60_000);
  await expect(page.locator('#connection')).toContainText('Taking longer than usual');
  expect(await page.evaluate(()=>(window as any).__torWorkers.map((worker:any)=>({closed:worker.closed,gateways:worker.init.config.gateways})))).toEqual([{closed:false,gateways:[gateway,gateway.replace(':12298:',':12299:')]}]);
  await page.evaluate(()=>(window as any).__torWorkers[0].resolve());
  await expect(page.locator('#connection')).toHaveText('Private worker ready');
  await expect(page.getByRole('button',{name:'Cancel connection'})).toHaveCount(0);
});
test('cancel ends startup without automatic retries or direct RPC, and manual retry resumes',async({page})=>{
  await page.clock.install();await pausedTor(page);await mockVerification(page);
  const publicPosts:string[]=[];page.on('request',request=>{if(request.method()==='POST')publicPosts.push(request.url());});
  await page.goto('/');
  await page.locator('#address').fill(address);await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__torWorkers.length)).toBe(1);
  await page.getByRole('button',{name:'Cancel connection'}).click();
  await expect(page.locator('#connection')).toContainText('Connection cancelled');
  await expect(page.locator('.wallet .spinner')).toHaveCount(0);
  await page.clock.fastForward(600_000);
  expect(await page.evaluate(()=>(window as any).__torWorkers.length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).__torWorkers[0].closed)).toBe(true);
  await page.getByRole('button',{name:'Retry connection'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__torWorkers.length)).toBe(2);
  await page.evaluate(()=>(window as any).__torWorkers[1].resolve());
  await expect(page.locator('.amount')).toHaveCount(0);
  expect(publicPosts).toEqual([]);
});
test('fresh mirrored directory bytes reach the hash-pinned worker, without fetching RPC',async({page})=>{
  await pausedTor(page);await page.unroute('**/tor-bootstrap.json');
  const bytes=Buffer.from([0x28,0xb5,0x2f,0xfd,1,2,3]);
  const digest=createHash('sha256').update(bytes).digest('hex');
  await page.route('**/tor-bootstrap.json',route=>route.fulfill({json:{version:1,updatedAt:Date.now(),archive:'tor-bootstrap-test.zip.zst',sha256:digest}}));
  await page.route('**/tor-bootstrap-test.zip.zst',route=>route.fulfill({body:bytes,contentType:'application/octet-stream'}));
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>(window as any).__torWorkers.length)).toBe(1);
  expect(await page.evaluate(()=>Array.from((window as any).__torWorkers[0].init.config.bootstrap))).toEqual([...bytes]);
});
test('HTTPS selection persists, avoids Tor and sends proof/consensus reads directly with accurate labels',async({page})=>{
  await pausedTor(page);
  await page.addInitScript(()=>{
    (window as any).__verifiers=[];
    (window as any).Worker=class{onmessage:any;request:any;sent:any[]=[];constructor(){(window as any).__verifiers.push(this);}postMessage(message:any){this.sent.push(message);if(message.type==='refresh')this.request=message;}terminate(){}};
  });
  const calls:{url:string;body:any}[]=[];
  await page.route('https://eth.drpc.org/**',route=>{
    const body=route.request().postDataJSON();calls.push({url:route.request().url(),body});
    return route.fulfill({json:{jsonrpc:'2.0',id:body.id,result:{}}});
  });
  await page.route('https://ethereum-beacon-api.publicnode.com/**',route=>{calls.push({url:route.request().url(),body:null});return route.fulfill({json:{data:{}}});});
  await page.goto('/');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByLabel('Connection mode',{exact:true})).toHaveValue('tor');
  await page.getByLabel('Connection mode',{exact:true}).selectOption('https');
  await expect(page.locator('#mode-hint')).toContainText('providers see your IP');
  await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:'Save settings and reconnect'}).click()]);
  await expect(page.getByRole('status',{name:'HTTPS connection',exact:true})).toHaveText('Direct HTTPS · not anonymous');
  expect(await page.evaluate(()=>(window as any).__torWorkers.length)).toBe(0);
  await page.locator('#address').fill(address);await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__verifiers.length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).__verifiers[0].request.mode)).toBe('https');
  await openWalletDetails(page,address);
  await page.evaluate(()=>{
    const worker=(window as any).__verifiers[0],run=worker.request.id;
    worker.onmessage({data:{type:'consensus',id:99,url:'https://ethereum-beacon-api.publicnode.com/eth/v1/beacon/genesis'}});
    worker.onmessage({data:{type:'rpc',run,id:1,body:{jsonrpc:'2.0',id:1,method:'eth_getProof',params:[worker.request.address,[],'0x100']}}});
  });
  await expect.poll(()=>calls.length).toBe(2);
  expect(calls.filter(call=>call.body).map(call=>call.body.method)).toEqual(['eth_getProof']);
  expect(JSON.stringify(calls)).not.toContain('isolationKey');
  await page.locator('.retrieval-log > summary').click();
  await expect(page.locator('.log-stream')).toContainText('Tracked address account proof · requested');
  await expect(page.locator('.log-stream')).not.toContainText('Submitted to Anon-RPC');
  await page.evaluate(()=>{const w=(window as any).__verifiers[0];w.onmessage({data:{type:'fatal',run:w.request.id,error:'Direct HTTPS provider unavailable'}});});
  await expect(page.locator('.amount')).toHaveText(['—','—']);
  await expect(page.locator('.wallet .spinner')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__torWorkers.length)).toBe(0);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('anonfolio.network.v1')!).mode)).toBe('https');
});
