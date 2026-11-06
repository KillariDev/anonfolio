import {expect,test,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {openAdvancedSettings,openWalletDetails} from './helpers';
const snapshot=JSON.parse(await readFile(new URL('../docs/images/portfolio-snapshot.json',import.meta.url),'utf8'));
async function setup(page:Page,width=390) {
  await page.setViewportSize({width,height:900});
  await page.addInitScript(snapshot=>{
    localStorage.setItem('anonfolio.portfolio.v2',JSON.stringify(snapshot.portfolio));
    localStorage.setItem('anonfolio.network.v1',JSON.stringify({mode:'https',rpcUrls:['https://execution.example/'],gateways:['152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ']}));
  },snapshot);
  await page.route('**/src/connection.ts*',route=>route.fulfill({contentType:'text/javascript',body:'export class Connection {constructor(state){this.state=state;} get(){this.state("ready");return Promise.resolve({transport:"https",fetch:async()=>{throw Error("No network in polish fixture");}});}close(){}}'}));
  await page.goto('/');
}
for(const width of [320,390,768,1440])test(`saved portfolio remains compact, readable and fully accessible at ${width}px`,async({page})=>{
  test.skip(!!process.env.BASE_URL || !!process.env.IPFS_GATEWAY_URL);
  await setup(page,width);
  await expect(page.locator('#estimated-total .portfolio-value-number')).toHaveText(/1,845,877,370\.28/);
  await expect(page.locator('.amount').first()).toHaveAttribute('data-tooltip',/5\.780441042197210512/);
  const rows=await page.locator('.balances').evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().height));
  if(width<720)expect(Math.max(...rows)).toBeLessThan(width===320?350:310);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const stops=await page.locator('.status-icon[tabindex="0"]').count();expect(stops).toBe(0);
  await openWalletDetails(page,snapshot.portfolio.wallets[0].address+' · '+snapshot.portfolio.wallets[0].name);
  expect((await page.locator('.verification-panel').first().boundingBox())!.height).toBeLessThan(60);
  await expect(page.locator('.verification-panel').first()).toContainText('Saved balances');
  await page.locator('.holdings-list').first().focus();
  await expect(page.getByRole('tooltip')).toContainText('5.780441042197210512');
  await page.keyboard.press('Escape');await expect(page.getByRole('tooltip')).toBeHidden();
  await expect(page.locator('.holdings-list').first()).toBeFocused();
  const refresh=await page.locator('.refresh-icon').first().boundingBox();expect(refresh!.height).toBeGreaterThanOrEqual(width<720?36:28);
  await page.screenshot({path:test.info().outputPath(`polished-portfolio-${width}.png`),fullPage:true});
});
for(const width of [320,390,1440])test(`Uniswap tooltip stays by its icon and ignores adjacent empty space at ${width}px`,async({page})=>{
  test.skip(!!process.env.BASE_URL || !!process.env.IPFS_GATEWAY_URL);
  await setup(page,width);
  const method=page.locator('#estimated-total .technology-uniswap').locator('..');
  const tooltip=page.getByRole('tooltip');
  await method.hover();
  await expect(tooltip).toContainText('30-minute Uniswap v3 TWAPs');
  const icon=(await method.boundingBox())!, bubble=(await tooltip.boundingBox())!;
  expect(bubble.x+bubble.width).toBeGreaterThanOrEqual(icon.x);
  expect(bubble.x).toBeLessThanOrEqual(icon.x+icon.width);
  expect(Math.abs(bubble.y-icon.y-icon.height)).toBeLessThan(12);
  const flags=(await page.locator('#estimated-total > .portfolio-value-meta > .valuation-flags').boundingBox())!;
  await page.mouse.move((flags.x+flags.width+icon.x)/2,icon.y+icon.height/2);
  await expect(tooltip).toBeHidden();
  await page.locator('.portfolio-value-number').focus();
  await expect(tooltip).toContainText('30-minute Uniswap v3 TWAPs');
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();
});
test('touch exposes and dismisses status explanations without changing saved balances',async({browser})=>{
  test.skip(!!process.env.BASE_URL || !!process.env.IPFS_GATEWAY_URL);
  const context=await browser.newContext({hasTouch:true,viewport:{width:390,height:844}});
  try {
    const page=await context.newPage();await setup(page);
    const before=await page.evaluate(()=>localStorage.getItem('anonfolio.portfolio.v2'));
    const badge=page.locator('.balance .status-icon').first();
    await badge.tap();await expect(page.getByRole('tooltip')).toContainText('Saved verified balance');
    await badge.tap();await expect(page.getByRole('tooltip')).toBeHidden();
    expect(await page.evaluate(()=>localStorage.getItem('anonfolio.portfolio.v2'))).toBe(before);
  }finally{await context.close();}
});
test('advanced settings stay collapsed and Tor controls follow the selected mode without losing edits',async({page})=>{
  test.skip(!!process.env.BASE_URL || !!process.env.IPFS_GATEWAY_URL);
  await setup(page);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.locator('#tor-routing')).toBeHidden();
  await expect(page.locator('#worker-settings')).toBeHidden();
  await expect(page.locator('#checkpoint-settings')).not.toHaveAttribute('open');
  await page.getByLabel('Connection mode',{exact:true}).selectOption('tor');
  await expect(page.locator('#tor-routing')).toBeVisible();
  await openAdvancedSettings(page,'tor-routing');
  const gateway=page.getByLabel('Tor gateways',{exact:true});const original=await gateway.inputValue();
  const changed=original.replace(':12298:',':12299:');await gateway.fill(changed);
  await page.getByLabel('Connection mode',{exact:true}).selectOption('https');
  await expect(page.locator('#tor-routing')).toBeHidden();
  await page.getByLabel('Connection mode',{exact:true}).selectOption('tor');
  await expect(gateway).toHaveValue(changed);
  await gateway.fill('invalid gateway');
  await page.getByLabel('Connection mode',{exact:true}).selectOption('https');
  await page.getByRole('button',{name:'Save settings and reconnect',exact:true}).click();
  await expect(page.locator('#settings-error')).toContainText('Tor gateway format');
  await expect(gateway).toBeVisible();
  await expect(page.getByLabel('Connection mode',{exact:true})).toHaveValue('https');
  await page.keyboard.press('Escape');await expect(page.locator('#settings-panel')).toBeHidden();
});
