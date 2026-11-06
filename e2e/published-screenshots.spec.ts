import { expect, test } from '@playwright/test';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { openTokenSettings } from './helpers';

const wallets=[
  {name:'vitalik.eth',address:'0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'},
  {name:'Ethereum Foundation',address:'0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe'},
  {name:'Uniswap treasury',address:'0x1a9C8182C09F50C8318d769245beA52c32BE35BC'},
];
const snapshotPath=new URL('../docs/images/portfolio-snapshot.json',import.meta.url);

test('published screenshots show verified public mainnet holdings and custom ERC-20s',async({page})=>{
  test.skip(!!process.env.BASE_URL || !!process.env.IPFS_GATEWAY_URL,'Source-module capture/replay harness.');
  const live=process.env.SCREENSHOT_LIVE==='1';
  test.setTimeout(live?900_000:30_000);
  const update=live || process.env.UPDATE_SCREENSHOTS==='1';
  const rpcUrls=['https://eth.drpc.org/','https://ethereum-rpc.publicnode.com/'];
  const icon=async(name:string)=>'data:image/png;base64,'+await readFile(new URL(`../src/assets/tokens/${name}.png`,import.meta.url),'base64');
  const tokens=[
    {address:'eth',symbol:'ETH',decimals:18,icon:'builtin:eth'},
    {address:'0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',symbol:'WETH',decimals:18,icon:'builtin:weth'},
    {address:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',symbol:'USDC',decimals:6,icon:await icon('usdc')},
    {address:'0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',symbol:'UNI',decimals:18,icon:await icon('uni')},
  ];
  const snapshot=live?undefined:JSON.parse(await readFile(snapshotPath,'utf8'));
  await page.addInitScript(({tokens,rpcUrls})=>{
    localStorage.setItem('anonfolio.portfolio.v2',JSON.stringify({version:3,tokens,wallets:[]}));
    localStorage.setItem('anonfolio.network.v1',JSON.stringify({mode:'https',rpcUrls,gateways:['152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ']}));
  },{tokens,rpcUrls});
  const rpcMethods:string[]=[];
  if(!live) {
    await page.route('**/src/connection.ts*',route=>route.fulfill({contentType:'text/javascript',body:`
      export class Connection {
        constructor(state){this.state=state;}
        get(){this.state('ready');return Promise.resolve({transport:'https',fetch:async()=>{throw new Error('Snapshot replay must not make network requests');}});}
        close(){}
      }
    `}));
    await page.route('**/src/verification/client.ts*',route=>route.fulfill({contentType:'text/javascript',body:`
      import {setHeliosStatus} from '/src/verification/status.ts';
      const snapshot=${JSON.stringify(snapshot)};
      export async function verifyWallet(wallet,worker,tokens,emit){
        const saved=snapshot.portfolio.wallets.find(entry=>entry.address.toLowerCase()===wallet.address.toLowerCase());
        if(!saved)throw new Error('Address missing from mainnet capture');
        for(const token of tokens){
          const balance=saved.balances[token.address];
          if(!balance?.verifiedBlock || balance.failed)throw new Error('Snapshot must contain proven balances');
          setHeliosStatus({phase:'ready',block:balance.verifiedBlock});
          emit({type:'asset',asset:token.address});
          emit({type:'balance',asset:token.address,amount:balance.amount,decimals:token.decimals,block:balance.verifiedBlock});
          if(balance.estimate)emit({type:'price',asset:token.address,estimate:balance.estimate,block:balance.verifiedBlock});
          else emit({type:'price-error',asset:token.address,error:balance.priceError||'No qualifying direct USDC pool at the captured block'});
        }
      }
    `}));
    await page.route('https://**',route=>route.abort('failed'));
  } else {
    page.on('request',request=>{
      if(request.method()==='POST' && request.postData()?.includes('jsonrpc'))rpcMethods.push(request.postDataJSON().method);
    });
  }
  await page.setViewportSize({width:1440,height:760});
  await page.goto('/');
  await page.locator('#address').fill(wallets.map(wallet=>`${wallet.name} | ${wallet.address}`).join('\n'));
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await expect(page.locator('.wallet')).toHaveCount(wallets.length);
  await expect.poll(()=>page.evaluate(()=>{
    const stored=JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')||'null');
    return stored?.wallets.length===3 && stored.wallets.every((wallet:any)=>stored.tokens.every((token:any)=>{
      const balance=wallet.balances[token.address];
      return !!balance?.verifiedBlock && !balance.failed && balance.amount!==undefined;
    }));
  }),{timeout:live?800_000:10_000,intervals:[1000,3000,5000]}).toBe(true);
  await expect(page.locator('.wallet[data-loading="true"]')).toHaveCount(0,{timeout:live?60_000:5000});
  await expect(page.locator('#helios-status strong')).toHaveText('Helios · ready');
  await expect(page.locator('#connection')).toHaveText('Direct HTTPS · not anonymous');
  const captured=await page.evaluate(()=>JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!));
  for(const symbol of ['USDC','UNI']) {
    const token=captured.tokens.find((token:any)=>token.symbol===symbol);
    expect(captured.wallets.some((wallet:any)=>BigInt(wallet.balances[token.address].amount)>0n)).toBe(true);
    expect(captured.wallets.every((wallet:any)=>!!wallet.balances[token.address].estimate)).toBe(true);
    await expect(page.locator('#totals')).toContainText(symbol);
  }
  if(live) {
    expect(rpcMethods).toContain('eth_getProof');
    expect(rpcMethods).not.toContain('eth_call');
    await writeFile(snapshotPath,JSON.stringify({capturedAt:new Date().toISOString(),transport:'Direct HTTPS',verification:'Helios 0.12.0 finalized execution with account/code/storage proof verification',rpcUrls,portfolio:captured},null,2)+'\n');
  }
  await expect.poll(()=>page.locator('img').evaluateAll(images=>images.every(image=>image.naturalWidth>0))).toBe(true);
  await page.evaluate(()=>document.fonts.ready);
  await page.mouse.move(0,0);
  await page.evaluate(()=>(document.activeElement as HTMLElement)?.blur());
  await expect(page.getByRole('tooltip')).toBeHidden();
  const readme=test.info().outputPath('readme-portfolio.png');
  await page.screenshot({path:readme,animations:'disabled',fullPage:true});
  if(update)await copyFile(readme,new URL('../docs/images/readme-portfolio.png',import.meta.url));
  await page.getByRole('button',{name:'Switch to light theme',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.mouse.move(0,0);
  await page.evaluate(()=>(document.activeElement as HTMLElement)?.blur());
  const readmeLight=test.info().outputPath('readme-portfolio-light.png');
  await page.screenshot({path:readmeLight,animations:'disabled',fullPage:true});
  if(update)await copyFile(readmeLight,new URL('../docs/images/readme-portfolio-light.png',import.meta.url));
  await page.getByRole('button',{name:'Switch to dark theme',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.setViewportSize({width:1440,height:900});
  await openTokenSettings(page);
  await expect(page.locator('#token-list')).toContainText('USDC');
  await expect(page.locator('#token-list')).toContainText('UNI');
  const guide=test.info().outputPath('portfolio.png');
  await page.screenshot({path:guide,animations:'disabled',fullPage:true});
  if(update)await copyFile(guide,new URL('../docs/images/portfolio.png',import.meta.url));
  // Keep mobile capture artifacts useful too, although only desktop images ship.
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('portfolio-mobile.png'),animations:'disabled',fullPage:true});
});
