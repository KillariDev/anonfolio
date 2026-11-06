import { expect, test, type Page } from '@playwright/test';
import { keccak256 } from 'viem';
import { mockVerification, openAddressForm, openWalletDetails } from './helpers';
const a = '0x0000000000000000000000000000000000000001';
const b = '0x0000000000000000000000000000000000000002';
async function connection(page: Page) {
  await page.route('**/src/connection.ts*', route => route.fulfill({ contentType: 'text/javascript', body: `
    window.__calls=[];
    export class Connection {
      constructor(state){this.state=state;}
      get(){this.state('ready');return Promise.resolve({fetch:async(url,init)=>{
        window.__calls.push(JSON.parse(init.body));
        return Response.json({jsonrpc:'2.0',id:1,result:'0xde0b6b3a7640000'});
      }});}
      close(){}
    }
  ` }));
}
async function add(page: Page, address: string) {
  await openAddressForm(page);
  await page.locator('#address').fill(address);
  await page.getByRole('button', { name: 'add address to track', exact: true }).click();
}
test('development serves exactly the pinned Tor worker bytes through its actual asset import', async ({ request }) => {
  test.skip(!!process.env.BASE_URL || !!process.env.IPFS_GATEWAY_URL, 'Development asset import test.');
  const module = await (await request.get('/src/connection.ts')).text();
  const urlImport = module.match(/import bundleUrl from ["']([^"']+)["']/)![1]!;
  const wrapper = await (await request.get(urlImport)).text();
  const asset = JSON.parse(wrapper.match(/export default ("[^"]+")/)![1]!);
  const response = await request.get(asset);
  expect(response.ok()).toBe(true);
  expect(keccak256(await response.body())).toBe('0x5b62f358ce7a2b94ee9bc3a0e6a08757db68fa08fc348276f31eda788aec818b');
});

test('removing queued and active addresses cancels verification and sends no late proof requests', async ({ page }) => {
  test.skip(!!process.env.BASE_URL || !!process.env.IPFS_GATEWAY_URL, 'Development verifier boundary injection.');
  await connection(page);
  await page.addInitScript(() => {
    (window as any).__verifiers=[];
    (window as any).Worker=class {
      request:any; sent:any[]=[]; terminated=false; onmessage:any;
      constructor(){(window as any).__verifiers.push(this);}
      postMessage(value:any){this.sent.push(value);if(value.type==='refresh')this.request=value;}
      terminate(){this.terminated=true;}
    };
  });
  await page.goto('/');
  await add(page, a+'\n'+b);
  await expect(page.getByRole('button', { name:'Queued '+b, exact:true })).toBeVisible();
  await openWalletDetails(page,b);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Remove '+b,exact:true}).click();
  await expect(page.locator('.wallet')).toHaveCount(1);
  await page.evaluate(()=>{const worker=(window as any).__verifiers[0];worker.onmessage({data:{type:'done',run:worker.request.id}});});
  await expect(page.getByRole('button',{name:'Refresh '+a,exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).__verifiers.flatMap((worker:any)=>worker.sent.filter((value:any)=>value.type==='refresh')).map((value:any)=>value.address))).toEqual([a]);
  await page.getByRole('button',{name:'Refresh '+a,exact:true}).click();
  await openWalletDetails(page,a);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Remove '+a,exact:true}).click();
  await expect(page.locator('.wallet')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__verifiers.at(-1).terminated)).toBe(true);
  await page.evaluate(async()=>{
    const worker=(window as any).__verifiers.at(-1);
    await worker.onmessage({data:{type:'rpc',run:worker.request.id,id:1,body:{jsonrpc:'2.0',id:1,method:'eth_getProof',params:[worker.request.address,[],{blockHash:'0x'+'11'.repeat(32)}]}}});
  });
  expect(await page.evaluate(()=>(window as any).__calls)).toEqual([]);
  await page.clock.install(); await page.clock.runFor(65_000);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).wallets)).toEqual([]);
});

test('tabs synchronize without reads and stale refreshes cannot overwrite or resurrect addresses', async ({ page, context }) => {
  test.skip(!!process.env.BASE_URL || !!process.env.IPFS_GATEWAY_URL, 'Development verifier boundary injection.');
  await connection(page); await mockVerification(page);
  await page.goto('/'); await add(page,a);
  await expect(page.getByRole('button',{name:'Refresh '+a,exact:true})).toBeEnabled();
  const other=await context.newPage(); await connection(other); await mockVerification(other);
  await other.addInitScript(()=>window.addEventListener('storage', event=>{if((window as any).__deferStorage)event.stopImmediatePropagation();},true));
  await other.goto('/'); await expect(other.locator('.wallet')).toHaveCount(1);
  await other.evaluate(()=>(window as any).__deferStorage=true);
  await add(page,b);
  await expect(page.getByRole('button',{name:'Refresh '+b,exact:true})).toBeEnabled();
  await expect(other.locator('.wallet')).toHaveCount(1);
  await other.getByRole('button',{name:'Refresh '+a,exact:true}).click();
  await expect(other.locator('.wallet')).toHaveCount(2);
  await expect(other.getByRole('button',{name:'Refresh '+a,exact:true})).toBeEnabled();
  expect(await other.evaluate(()=>(window as any).__calls.length)).toBe(2);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).wallets.map((value:any)=>value.address))).toEqual([a,b]);
  await openWalletDetails(page,b); page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Remove '+b,exact:true}).click();
  await other.getByRole('button',{name:'Refresh '+a,exact:true}).click();
  await expect(other.locator('.wallet')).toHaveCount(1);
  expect(await other.evaluate(()=>JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).wallets.map((value:any)=>value.address))).toEqual([a]);
  await other.evaluate(()=>(window as any).__deferStorage=false);
  const calls=await other.evaluate(()=>(window as any).__calls.length);
  await add(page,b);
  await expect(other.locator('.wallet')).toHaveCount(2);
  expect(await other.evaluate(()=>(window as any).__calls.length)).toBe(calls);
  await other.close();
});

test('simultaneous tab edits serialize under one portfolio lock without losing either address', async ({ page, context }) => {
  test.skip(!!process.env.BASE_URL || !!process.env.IPFS_GATEWAY_URL, 'Development verifier boundary injection.');
  await connection(page); await mockVerification(page); await page.goto('/');
  const other=await context.newPage(); await connection(other); await mockVerification(other); await other.goto('/');
  await page.evaluate(()=>{void navigator.locks.request('anonfolio.portfolio.v2',()=>new Promise<void>(resolve=>{(window as any).__releasePortfolio=resolve;}));});
  await expect.poll(()=>page.evaluate(()=>typeof (window as any).__releasePortfolio)).toBe('function');
  await Promise.all([add(page,a),add(other,b)]);
  await page.evaluate(()=>(window as any).__releasePortfolio());
  await expect(page.locator('.wallet')).toHaveCount(2); await expect(other.locator('.wallet')).toHaveCount(2);
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).wallets.map((value:any)=>value.address).sort())).toEqual([a,b]);
  await other.close();
});
