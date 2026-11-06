import { expect, test } from '@playwright/test';

test('live Tor worker update downloads and hash-checks the published HTTPS resolver',async({page})=>{
  test.skip(!process.env.LIVE_WORKER_UPDATE,'Opt in with LIVE_WORKER_UPDATE=1; queries PublicNode and downloads the worker.');
  test.setTimeout(150_000);
  await page.addInitScript(()=>localStorage.setItem('anonfolio.network.v1',JSON.stringify({mode:'https',gateways:['152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ'],rpcUrls:['https://eth.drpc.org/']})));
  const discovery:any[]=[];
  page.on('request',request=>{if(request.url()==='https://ethereum-rpc.publicnode.com/'&&request.method()==='POST')discovery.push(request.postDataJSON());});
  await page.goto('/');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Update Tor worker from PublicNode',exact:true}).click();
  await expect(page.locator('#tor-worker-status')).toContainText('Update downloaded and hash-checked',{timeout:120_000});
  await expect(page.getByLabel('Tor worker source',{exact:true})).toHaveValue('updated');
  await expect(page.locator('#tor-worker-metadata')).toContainText('https://');
  await expect(page.locator('#tor-worker-metadata')).not.toContainText('kps:');
  expect(discovery.map(call=>call.method)).toEqual(['eth_blockNumber','eth_call','eth_call']);
  expect(discovery.slice(1).every(call=>call.params[0].to.toLowerCase()==='0x700da3193d35fa54cd3fbf29b66f2a2a0385659e'&&call.params[1]===discovery[1].params[1])).toBe(true);
  await test.info().attach('worker-metadata',{body:(await page.locator('#tor-worker-metadata').textContent())!,contentType:'text/plain'});
});
