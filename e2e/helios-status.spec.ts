import { expect, test, type Page } from '@playwright/test';
const address='0x0000000000000000000000000000000000000001';
async function setup(page:Page,width:number) {
  await page.setViewportSize({width,height:844});
  await page.route('**/src/connection.ts*',route=>route.fulfill({contentType:'text/javascript',body:`
    export class Connection {
      constructor(state){this.state=state;}
      get(){this.state('ready');return Promise.resolve({fetch:async()=>{throw new Error('Unexpected transport call');}});}
      close(){}
    }
  `}));
  await page.addInitScript(()=>{
    const NativeWorker=window.Worker;
    (window as any).__heliosWorkers=[];
    window.Worker=function(url:any,options:any) {
      if(String(url).includes('helios.worker')) {
        const worker={onmessage:null as any,onerror:null as any,onmessageerror:null as any,terminated:false,request:null as any,
          postMessage(message:any){if(message.type==='refresh')this.request=message;},
          terminate(){this.terminated=true;},
          emit(message:any){this.onmessage?.({data:{run:this.request?.id,...message}});}};
        (window as any).__heliosWorkers.push(worker);
        return worker;
      }
      return new NativeWorker(url,options);
    } as any;
  });
  await page.goto('/');
}
async function emit(page:Page,message:object,index=0) {
  await page.evaluate(({message,index})=>(window as any).__heliosWorkers[index].emit(message),{message,index});
}
for(const width of [1280,768,390,320]) test(`Helios header follows actual verifier lifecycle without layout shifts at ${width}px`,async({page})=>{
  test.skip(!!process.env.BASE_URL || !!process.env.IPFS_GATEWAY_URL,'Development worker lifecycle fixture.');
  await setup(page,width);
  const status=page.locator('#helios-status');
  await expect(status.locator('strong')).toHaveText('Helios · idle');
  await expect(status).toHaveAttribute('title',/starts when you refresh/);
  expect(await page.evaluate(()=>(window as any).__heliosWorkers.length)).toBe(0);
  const bounds=await status.boundingBox();const connection=await page.locator('#connection').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(connection!.x+connection!.width);
  expect(Math.abs(bounds!.y-connection!.y)).toBeLessThanOrEqual(1);
  const samples:number[]=[];
  async function sample() {
    samples.push(await page.locator('main').evaluate(node=>node.getBoundingClientRect().top));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await sample();
  await page.locator('#address').fill(address);
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await expect(status.locator('strong')).toHaveText('Helios · starting');
  await expect(status.locator('.spinner')).toHaveCount(1);await sample();
  await emit(page,{type:'helios-status',status:{phase:'syncing'}});
  await expect(status.locator('strong')).toHaveText('Helios · syncing');await sample();
  const block={hash:'0x'+'11'.repeat(32),stateRoot:'0x'+'22'.repeat(32),number:'0x100',timestamp:Date.now()-60000};
  await emit(page,{type:'helios-status',status:{phase:'ready',block}});
  await expect(status.locator('strong')).toHaveText('Helios · ready');
  await expect(status).toHaveAttribute('title',/Last verified finalized block 256/);
  await expect(status.locator('.spinner')).toHaveCount(0);await sample();
  await page.screenshot({path:test.info().outputPath(`helios-ready-${width}.png`)});
  // A worker failure clears readiness and the spinner, even after a good block.
  await page.evaluate(()=>(window as any).__heliosWorkers[0].onerror({message:'Verifier crashed'}));
  await expect(status.locator('strong')).toHaveText('Helios · unavailable');
  await expect(status).toHaveAttribute('title',/Verifier crashed/);
  await expect(status.locator('.spinner')).toHaveCount(0);await sample();
  expect(Math.max(...samples)-Math.min(...samples)).toBeLessThanOrEqual(1);
  // A terminated worker cannot overwrite the new lifecycle with a late reply.
  await emit(page,{type:'helios-status',status:{phase:'ready',block}});
  await expect(status.locator('strong')).toHaveText('Helios · unavailable');
  await status.focus();await expect(status).toBeFocused();
});

test('cancelling verification clears Helios loading and restarting creates a new lifecycle',async({page})=>{
  test.skip(!!process.env.BASE_URL || !!process.env.IPFS_GATEWAY_URL,'Development worker lifecycle fixture.');
  await setup(page,390);
  await page.locator('#address').fill(address);
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await expect(page.locator('#helios-status strong')).toHaveText('Helios · starting');
  // Page lifecycle cancellation uses the same abort path as removed addresses.
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  await expect(page.locator('#helios-status strong')).toHaveText('Helios · idle');
  await expect(page.locator('#helios-status .spinner')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__heliosWorkers[0].terminated)).toBe(true);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await page.getByRole('button',{name:'Refresh '+address,exact:true}).click();
  await expect(page.locator('#helios-status strong')).toHaveText('Helios · starting');
  expect(await page.evaluate(()=>(window as any).__heliosWorkers.length)).toBe(2);
});
