import { expect, test, type Page } from '@playwright/test';

async function demo(page: Page, mode: 'tor' | 'https' = 'tor') {
  await page.addInitScript(mode => {
    if (mode === 'https') localStorage.setItem('anonfolio.network.v1', JSON.stringify({ mode, rpcUrls: ['https://execution.example/'], gateways: ['152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ'] }));
  }, mode);
  await page.route('**/src/connection.ts*', route => route.fulfill({ contentType: 'text/javascript', body: `
    export class Connection {
      constructor(state) { this.state=state; window.__connection=this; }
      get() { this.state('ready'); return Promise.resolve({transport:'${mode}',fetch:async()=>{throw new Error('Demo verifier must not make requests')}}); }
      close() {}
    }
  ` }));
  await page.route('**/src/verification/client.ts*', route => route.fulfill({ contentType: 'text/javascript', body: `
    import { setHeliosStatus } from '/src/verification/status.ts';
    export async function verifyWallet(wallet,worker,tokens,emit) {
      const index=Number(wallet.address.slice(-1))-1;
      const amounts=[['130000000000000000','20000000000000000'],['1420000000000000000','750000000000000000'],['3120000000000000000','1250000000000000000']];
      const block={hash:'0x'+'11'.repeat(32),stateRoot:'0x'+'22'.repeat(32),number:'0x1800000',timestamp:Date.now()-15*60000};
      setHeliosStatus({phase:'ready',block});
      for(const token of tokens) {
        emit({type:'asset',asset:token.address});
        emit({type:'balance',asset:token.address,amount:amounts[index][token.address==='eth'?0:1],block});
        emit({type:'price',asset:token.address,block,estimate:{pool:'0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',quote:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',symbol:'USDC',decimals:6,numerator:'2000000000',denominator:'1000000000000000000',window:1800,blockHash:block.hash,minLiquidity:'10000'}});
      }
    }
  ` }));
}
for (const width of [1280,390]) test(`technology indicators stay readable through Tor states at ${width}px`, async ({page}) => {
  test.skip(!!process.env.BASE_URL || !!process.env.IPFS_GATEWAY_URL, 'Development connection boundary fixture.');
  await page.setViewportSize({width,height:844});
  const external: string[]=[];
  page.on('request', request=>{if(!request.url().startsWith('http://127.0.0.1:5173/')&&!request.url().startsWith('data:'))external.push(request.url());});
  await demo(page);
  await page.goto('/');
  const logo=page.locator('#connection .technology-tor');
  await expect(logo).toHaveAttribute('alt','Tor via Anon-RPC');
  await expect(logo).toHaveAttribute('title','Tor via Anon-RPC');
  await expect.poll(()=>logo.evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.network .technology-ethereum')).toHaveAttribute('title','Ethereum mainnet');
  await expect(page.locator('#estimated-total .technology-uniswap')).toHaveCount(1);
  await expect(page.locator('#estimated-total .technology-uniswap').locator('..')).toHaveAttribute('title',/Uniswap v3 TWAP/);
  await expect(logo).toHaveAttribute('src', /tor-onion/);
  const original=await logo.boundingBox();
  const initialConnection=await page.locator('#connection').boundingBox();
  for(const state of ['starting','failed','ready']) {
    await page.evaluate(state=>(window as any).__connection.state(state),state);
    await expect(page.locator('#connection .spinner')).toHaveCount(state==='starting'?1:0);
    await expect(page.locator('#connection button')).toHaveCount(state==='ready'?0:1);
    const connection=await page.locator('#connection').boundingBox();
    expect(connection!.width).toBe(initialConnection!.width);
    expect(connection!.height).toBe(initialConnection!.height);
    expect(connection!.width).toBeLessThanOrEqual(360);
    const box=await logo.boundingBox();
    expect(box!.width).toBe(original!.width); expect(box!.height).toBe(original!.height);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.screenshot({path:test.info().outputPath(`connection-ready-${width}.png`)});
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.locator('#pricing-form h2 .technology-uniswap')).toHaveAttribute('title',/Uniswap v3/);
  await page.screenshot({path:`test-results/technology-settings-${width}.png`});
  expect(external).toEqual([]);
});

test('explicit HTTPS mode never shows a Tor connection logo', async ({page}) => {
  test.skip(!!process.env.BASE_URL || !!process.env.IPFS_GATEWAY_URL, 'Development connection boundary fixture.');
  await demo(page,'https'); await page.goto('/');
  await expect(page.locator('#connection')).toHaveText('Direct HTTPS · not anonymous');
  await expect(page.locator('#connection .technology-tor')).toHaveCount(0);
  await expect(page.locator('.network .technology-ethereum')).toBeVisible();
});

test('static build technology logos remain available after an offline reload', async ({page,context}) => {
  test.skip(!process.env.BASE_URL,'Production offline shell test.');
  await page.route('https://**',route=>route.abort('failed'));
  await page.goto('/');
  await page.evaluate(async()=>{
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller) await new Promise<void>(resolve=>navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(),{once:true}));
  });
  await context.setOffline(true); await page.reload();
  for(const selector of ['.brand-mark','#connection .technology-tor','.network .technology-ethereum','#estimated-total .technology-uniswap']) {
    await expect(page.locator(selector)).toBeVisible();
    await expect.poll(()=>page.locator(selector).evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await context.setOffline(false);
});
