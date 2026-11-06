import { openWalletDetails } from './helpers';
import { expect, test } from '@playwright/test';
test('live mainnet verified ETH and WETH through explicitly selected HTTPS',async({page})=>{
  test.skip(!process.env.LIVE_HTTPS,'Opt in with bun run test:live:https. Uses real mainnet providers and verification.');
  test.setTimeout(240_000);
  const rpc=process.env.LIVE_BALANCE_RPC||'https://eth.drpc.org/';
  await page.addInitScript(rpc=>localStorage.setItem('anonfolio.network.v1',JSON.stringify({mode:'https',gateways:['152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ'],rpcUrls:[rpc]})),rpc);
  const methods:string[]=[];
  page.on('request',request=>{if(request.method()==='POST'&&request.postData()?.includes('jsonrpc')){const body=request.postDataJSON();expect(Array.isArray(body)).toBe(false);methods.push(body.method);}});
  await page.goto('/');
  await expect(page.locator('#connection')).toHaveText('Direct HTTPS · not anonymous');
  await page.locator('#address').fill('0x0000000000000000000000000000000000000001');
  await page.getByRole('button',{name:'add address to track',exact:true}).click();
  await openWalletDetails(page,'0x0000000000000000000000000000000000000001');
  // Wait for both price jobs too: returning after the balances alone would miss
  // concurrency/deadlock regressions in the shared WASM client's oracle calls.
  await expect(page.locator('.progress-heading')).toContainText('4/4 checks',{timeout:180_000});
  const values=await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('anonfolio.portfolio.v2')!).wallets[0].balances) as any[]);
  expect(values).toHaveLength(2);
  expect(values.every(value=>value.estimate?.blockHash===value.verifiedBlock.hash)).toBe(true);
  await page.locator('.retrieval-log > summary').click();
  await expect(page.locator('.log-stream')).toContainText('WETH bytecode');
  await expect(page.locator('.log-stream')).toContainText('Tracked address account proof');
  expect(values.every(value=>value.verifiedBlock?.hash&&value.verifiedBlock.timestamp&&!value.failed)).toBe(true);
  expect(new Set(values.map(value=>value.verifiedBlock.hash)).size).toBe(1);
  expect(methods).toContain('eth_getProof');
  // The default WETH/factory/pool code is bundled; proofs still come from the provider.
  expect(methods).not.toContain('eth_getCode');
  await expect(page.locator('.log-stream')).toContainText('bundled code matches proven account');
  expect(methods).not.toContain('eth_call');
  expect(methods).not.toContain('eth_getBalance');
  await expect(page.locator('iframe')).toHaveCount(0);
  await test.info().attach('https-verified-balances',{body:JSON.stringify({rpc,methods,values},null,2),contentType:'application/json'});
});
