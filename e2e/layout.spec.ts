import { expect, test, type Page } from '@playwright/test';
import { openWalletDetails } from './helpers';

const a='0x0000000000000000000000000000000000000001';
const weth='0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
async function setup(page:Page,width:number,count=10) {
  await page.setViewportSize({width,height:844});
  await page.route('**/src/connection.ts*',route=>route.fulfill({contentType:'text/javascript',body:`
    export class Connection {constructor(state){this.state=state;window.__connectionState=state;} get(){this.state('ready');return Promise.resolve({fetch(){throw new Error('Unused');}});} close(){}}
  `}));
  await page.addInitScript(()=>{
    (window as any).__verifiers=[];
    (window as any).Worker=class {
      onmessage:any;request:any;terminated=false;constructor(){(window as any).__verifiers.push(this);}
      postMessage(request:any){if(request.type==='refresh')this.request=request;}
      terminate(){this.terminated=true;}
    };
  });
  await page.goto('/');
  await page.locator('#address').fill(Array.from({length:count},(_,i)=>'0x'+(i+1).toString(16).padStart(40,'0')).join('\n'));
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await openWalletDetails(page,a);
}
async function emit(page:Page,event:object){await page.evaluate(event=>{const w=(window as any).__verifiers.findLast((worker:any)=>worker.request&&!worker.terminated);w.onmessage({data:{...event,run:w.request.id}});},event);}
for(const width of [1280,390]) {
  test(`address details use compact consistent spacing at ${width}px`,async({page})=>{
    test.skip(!!process.env.BASE_URL);
    await setup(page,width,2);
    const content=page.locator('.detail-content').first();
    const spacing=()=>content.evaluate(node=>{
      const children=[...node.children].filter(child=>getComputedStyle(child).display!=='none');
      const boxes=children.map(child=>child.getBoundingClientRect());
      return {height:node.getBoundingClientRect().height,gaps:boxes.slice(1).map((box,i)=>box.top-boxes[i].bottom)};
    });
    expect((await spacing()).gaps.every(gap=>gap>=0&&gap<=8)).toBe(true);
    expect(await page.locator('.activity > p').first().evaluate(node=>node.getBoundingClientRect().height)).toBe(0);
    expect((await spacing()).height).toBeLessThan(420);
    await emit(page,{type:'done'});
    await expect(page.locator('.verification-panel').first()).toHaveClass(/is-finished/);
    expect((await spacing()).height).toBeLessThan(230);
    expect((await spacing()).gaps.every(gap=>gap>=0&&gap<=8)).toBe(true);
    await page.locator('.history-details > summary').first().click();
    await expect(page.locator('.read-history').first()).toBeVisible();
    await page.screenshot({path:'/tmp/anonfolio-compact-details-'+width+'.png',fullPage:true});
  });
  test(`opened address has one scroll owner, including requests and logs, at ${width}px`,async({page})=>{
    test.skip(!!process.env.BASE_URL);
    await setup(page,width);
    const request={method:'eth_getProof',host:'rpc.example',state:'waiting',startedAt:Date.now(),deadline:Date.now()+90_000};
    for(let i=0;i<4;i++)await emit(page,{type:'network',request:{...request,requestId:i,method:['eth_getProof','eth_getCode','eth_call','eth_getStorageAt'][i]}});
    await expect(page.locator('.progress-request')).toHaveCount(2);
    await expect(page.locator('.progress-hint').first()).toContainText('+2 more private requests');
    expect(await page.locator('.progress-hint').first().evaluate(node=>node.getBoundingClientRect().bottom<=node.parentElement!.getBoundingClientRect().bottom)).toBe(true);
    const requestOwners=await page.locator('.progress-request').first().evaluate(node=>{
      const owners:string[]=[];
      for(let p=node.parentElement;p;p=p.parentElement)if(/auto|scroll/.test(getComputedStyle(p).overflowY)&&p.scrollHeight>p.clientHeight+1)owners.push(p.id||p.className);
      return owners;
    });
    expect(requestOwners).toEqual(['wallets']);
    await page.locator('.retrieval-log > summary').first().click();
    for(let i=0;i<20;i++)await emit(page,{type:'progress',message:'Checking account proof '+i+': '+ 'A detailed verification message. '.repeat(4)});
    const owners=await page.locator('.log-stream li').last().evaluate(node=>{
      const owners:string[]=[];
      for(let p=node.parentElement;p;p=p.parentElement)if(/auto|scroll/.test(getComputedStyle(p).overflowY)&&p.scrollHeight>p.clientHeight+1)owners.push(p.id||p.className);
      return owners;
    });
    expect(owners).toEqual(['wallets']);
    await expect(page.locator('.log-stream').first()).toContainText('eth_call');
    await expect(page.locator('.log-stream').first()).toContainText('eth_getStorageAt');
  });
  test(`automatic loading does not move address sections at ${width}px`,async({page})=>{
    test.skip(!!process.env.BASE_URL);
    await setup(page,width);
    const selectors=['.overview','.total','.section-heading','.verification-panel','.activity','.detail-actions','.wallet:nth-of-type(2) > .balances'];
    const measure=()=>page.evaluate(selectors=>selectors.map(selector=>{
      const r=document.querySelector(selector)!.getBoundingClientRect();return {selector,top:r.top,height:r.height};
    }),selectors);
    const before=await measure();
    const block={hash:'0x'+'11'.repeat(32),stateRoot:'0x'+'22'.repeat(32),number:'0x100',timestamp:Date.now()-60_000};
    for(const event of [
      {type:'progress',stage:'balances-pricing',message:'Checking private proofs. '.repeat(40)},
      {type:'balance',asset:'eth',amount:'12345678912345678912345',block},
      {type:'price',asset:'eth',block,estimate:{pool:'0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',quote:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',symbol:'USDC',decimals:6,numerator:'2000000000',denominator:'1000000000000000000',window:1800,blockHash:block.hash,minLiquidity:'10000'}},
      {type:'asset-error',asset:weth,error:'Contract proof failed. '.repeat(30)},
      {type:'price-error',asset:'eth',error:'No qualifying direct pool'},
    ]) {
      await emit(page,event);
      const after=await measure();
      for(let i=0;i<before.length;i++)for(const key of ['top','height'] as const)expect(Math.abs(after[i][key]-before[i][key]),selectors[i]+' '+key).toBeLessThanOrEqual(1);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await emit(page,{type:'done'});
    await expect(page.locator('.verification-panel').first()).toHaveClass(/is-finished/);
    expect((await page.locator('.verification-panel').first().boundingBox())!.height).toBeLessThan(60);
    await page.getByRole('button',{name:'Refresh '+a,exact:true}).click();
    const refreshed=await measure();
    for(let i=0;i<before.length;i++)expect(Math.abs(refreshed[i].height-before[i].height)).toBeLessThanOrEqual(1);
  });
}

for(const width of [1280,390]) test(`reading position survives history growth, new errors and log updates at ${width}px`,async({page})=>{
  test.skip(!!process.env.BASE_URL);
  await setup(page,width);
  await page.locator('.history-details > summary').first().click();
  await page.locator('.failure-details > summary').first().click();
  await page.locator('.retrieval-log > summary').first().click();
  for(let i=0;i<50;i++)await emit(page,{type:'progress',message:'Proof step '+i+': '+ 'Checking a verified storage witness. '.repeat(3)});
  const line=page.locator('.log-stream li').nth(15);
  const marker=await line.getAttribute('data-log-id');
  await line.evaluate(node=>{
    const root=document.querySelector('#wallets')!;
    root.scrollTop+=node.getBoundingClientRect().top-root.getBoundingClientRect().top-100;
    (window as any).__readingNode=node;
    (node.closest('.log-stream') as HTMLElement).focus({preventScroll:true});
  });
  const y=(await line.boundingBox())!.y;
  const block={hash:'0x'+'11'.repeat(32),stateRoot:'0x'+'22'.repeat(32),number:'0x100',timestamp:Date.now()-60_000};
  for(const event of [
    {type:'balance',asset:'eth',amount:'1000000000000000000',block},
    {type:'asset-error',asset:weth,error:'Storage proof unavailable. '.repeat(12)},
    {type:'price-error',asset:'eth',error:'No qualifying direct pool'},
    {type:'progress',message:'A new message while reading earlier log entries'},
  ]) {
    await emit(page,event);
    const retained=page.locator('.log-stream li[data-log-id="'+marker+'"]');
    expect(Math.abs((await retained.boundingBox())!.y-y)).toBeLessThanOrEqual(1);
    expect(await retained.evaluate(node=>node===(window as any).__readingNode)).toBe(true);
    await expect(page.locator('.log-stream').first()).toBeFocused();
  }
  // Error reports must retain identity when another token's report is inserted ahead of them.
  const report=page.getByRole('region',{name:'WETH balance failure',exact:true});
  await report.evaluate(node=>(window as any).__wethReport=node);
  await emit(page,{type:'asset-error',asset:'eth',error:'Account proof unavailable'});
  expect(await report.evaluate(node=>node===(window as any).__wethReport)).toBe(true);
  // The detail pane follows the portfolio's width while the token columns scroll horizontally.
  await page.locator('#wallets').evaluate(node=>{node.scrollLeft=node.scrollWidth;});
  const size=await page.evaluate(()=>{
    const root=document.querySelector('#wallets')!,pane=document.querySelector('.detail-inner')!;
    return {pane:pane.getBoundingClientRect().width,available:root.clientWidth,page:document.documentElement.scrollWidth,viewport:innerWidth};
  });
  expect(size.pane).toBeLessThanOrEqual(size.available);
  expect(size.page).toBeLessThanOrEqual(size.viewport);
  await page.screenshot({path:'/tmp/anonfolio-single-scroll-'+width+'.png',fullPage:true});
});

for(const width of [1280,390]) test(`connection retry controls do not shift the portfolio at ${width}px`,async({page})=>{
  test.skip(!!process.env.BASE_URL);
  await setup(page,width);
  const positions=await page.evaluate(()=>{
    const samples=[];
    for(const state of ['starting','failed','ready']) {
      (window as any).__connectionState(state);
      samples.push({header:document.querySelector('header')!.getBoundingClientRect().height,top:document.querySelector('main')!.getBoundingClientRect().top});
    }
    return samples;
  });
  for(const key of ['header','top'] as const) expect(Math.max(...positions.map(p=>p[key]))-Math.min(...positions.map(p=>p[key]))).toBeLessThanOrEqual(1);
});

test('error cards and disclosure state stay with the contract when token symbols match',async({page})=>{
  test.skip(!!process.env.BASE_URL);
  await page.addInitScript(weth=>localStorage.setItem('anonfolio.portfolio.v2',JSON.stringify({version:3,tokens:[{address:'eth',symbol:'ETH',decimals:18},{address:weth,symbol:'ETH',decimals:18}],wallets:[]})),weth);
  await setup(page,1280,1);
  await emit(page,{type:'asset-error',asset:'eth',error:'Native account proof failed'});
  await emit(page,{type:'asset-error',asset:weth,error:'Wrapped contract proof failed'});
  await page.locator('.balance[data-asset="'+weth+'"]').first().locator('.failure-link').click();
  const card=page.locator('.read-failure[data-view-key="'+weth+':balance"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Wrapped contract proof failed');
  await card.locator('.failure-technical > summary').click();
  await card.evaluate(node=>(window as any).__sameSymbolCard=node);
  await page.getByRole('button',{name:'Refresh '+a,exact:true}).click();
  const block={hash:'0x'+'11'.repeat(32),stateRoot:'0x'+'22'.repeat(32),number:'0x100',timestamp:Date.now()-60_000};
  await emit(page,{type:'balance',asset:'eth',amount:'0',block});
  expect(await card.evaluate(node=>node===(window as any).__sameSymbolCard)).toBe(true);
  await expect(card.locator('.failure-technical')).toHaveJSProperty('open',true);
  await expect(page.locator('.read-failure[data-view-key="eth:balance"]')).toHaveCount(0);
});

for(const width of [1280,390]) test(`the visible token read stays in place when its finalized-block group changes at ${width}px`,async({page})=>{
  test.skip(!!process.env.BASE_URL);
  await setup(page,width);
  await page.locator('.history-details > summary').first().click();
  const row=page.locator('.read-times tbody tr[data-asset="'+weth+'"]').first();
  await row.evaluate(node=>{const root=document.querySelector('#wallets')!;root.scrollTop+=node.getBoundingClientRect().top-root.getBoundingClientRect().top-50;});
  const before=(await row.boundingBox())!.y;
  expect(Math.abs(before-(await page.locator('#wallets').boundingBox())!.y-50)).toBeLessThanOrEqual(1);
  const block={hash:'0x'+'11'.repeat(32),stateRoot:'0x'+'22'.repeat(32),number:'0x100',timestamp:Date.now()-60_000};
  await emit(page,{type:'balance',asset:weth,amount:'0',block});
  expect(Math.abs((await row.boundingBox())!.y-before)).toBeLessThanOrEqual(1);
});

test('a log tail below the browser viewport does not pull the reader away',async({page})=>{
  test.skip(!!process.env.BASE_URL);
  await setup(page,390);
  await page.locator('.retrieval-log > summary').first().click();
  for(let i=0;i<25;i++)await emit(page,{type:'progress',message:'Checking private proof '+i+': '+ 'A detailed status message. '.repeat(4)});
  const reading=await page.evaluate(()=>{
    window.scrollTo(0,0);
    const root=document.querySelector('#wallets')!, log=document.querySelector('.log-stream')!;
    root.scrollTop+=log.lastElementChild!.getBoundingClientRect().bottom-root.getBoundingClientRect().bottom+8;
    const node=[...log.querySelectorAll<HTMLElement>('li')].find(node=>{const r=node.getBoundingClientRect();return r.top>=root.getBoundingClientRect().top+42&&r.bottom<innerHeight;})!;
    return {id:node.dataset.logId,y:node.getBoundingClientRect().top,tail:log.lastElementChild!.getBoundingClientRect().bottom,viewport:innerHeight};
  });
  expect(reading.tail).toBeGreaterThan(reading.viewport);
  await emit(page,{type:'progress',message:'A new log message outside the visible browser viewport'});
  const row=page.locator('.log-stream li[data-log-id="'+reading.id+'"]');
  expect(Math.abs((await row.boundingBox())!.y-reading.y)).toBeLessThanOrEqual(1);
});
