import { expect, test } from '@playwright/test';

for (const width of [1280, 390]) test(`HTML system guide renders and explains network modes at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const external: string[] = [], errors: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).origin !== new URL(process.env.BASE_URL || 'http://127.0.0.1:5173').origin) external.push(request.url());
  });
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto('/docs/documentation.html');
  expect(response!.ok()).toBe(true);
  await expect(page.getByRole('heading', {name:'How Anonfolio works',exact:true})).toBeVisible();
  await expect(page.locator('.chapter')).toHaveCount(11);
  await expect(page.locator('svg.chart[role="img"]')).toHaveCount(3);
  expect(await page.evaluate(() => {
    const ids=[...document.querySelectorAll('[id]')].map(node=>node.id);
    return ids.length===new Set(ids).size && [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')].every(link=>document.getElementById(link.hash.slice(1)));
  })).toBe(true);
  if (!(await page.locator('.contents details').evaluate(node=>(node as HTMLDetailsElement).open))) await page.locator('.contents summary').click();
  await page.getByRole('link',{name:'Connection modes and execution transport',exact:true}).click();
  await expect(page.locator('#tor-route')).toBeVisible();
  await expect(page.locator('#https-route')).toBeHidden();
  await page.getByRole('tab',{name:'Direct HTTPS · explicit',exact:true}).click();
  await expect(page.locator('#https-route')).toBeVisible();
  await expect(page.locator('#https-route')).toContainText('Sees the browser IP');
  await expect(page.locator('#tor-route')).toBeHidden();
  await page.getByRole('tab',{name:'Direct HTTPS · explicit',exact:true}).press('ArrowLeft');
  await expect(page.getByRole('tab',{name:'Tor · default',exact:true})).toBeFocused();
  await expect(page.locator('#tor-route')).toBeVisible();
  await expect(page.locator('#tor-route')).toContainText('KPS gateway');
  await page.locator('.screenshot').scrollIntoViewIfNeeded();
  await expect.poll(()=>page.locator('.screenshot').evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  await page.locator('#connection-modes-and-execution-transport .visual').screenshot({path:`test-results/documentation-network-${width}.png`});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:`test-results/documentation-${width}.png`});
  if (width===1280) {
    await page.emulateMedia({media:'print'});
    await expect(page.locator('#tor-route')).toBeVisible();
    await expect(page.locator('#https-route')).toBeVisible();
    await expect(page.locator('body')).toHaveCSS('background-color','rgb(255, 255, 255)');
  }
});

test('HTML system guide is readable without JavaScript or the app', async ({ browser }) => {
  const context=await browser.newContext({javaScriptEnabled:false});
  try {
    const page=await context.newPage();
    await page.goto(new URL('../docs/documentation.html',import.meta.url).href);
    await expect(page.locator('#tor-route')).toBeVisible();
    await expect(page.locator('#https-route')).toBeVisible();
    await expect(page.locator('#consensus-and-balance-verification')).toContainText('storage slots');
    await expect(page.locator('#direct-pool-twap-estimates')).toContainText('observe([1800, 0])');
    await page.locator('.screenshot').scrollIntoViewIfNeeded();
    await expect.poll(()=>page.locator('.screenshot').evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(page.workers()).toHaveLength(0);
  } finally { await context.close(); }
});

test('static build documentation and image reopen offline from the application shell', async ({page, context})=>{
  test.skip(!process.env.BASE_URL,'Build and run bun run test:static.');
  await page.addInitScript(()=>localStorage.setItem('anonfolio.network.v1',JSON.stringify({mode:'https',rpcUrls:['https://execution.example/'],gateways:['152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ']})));
  await page.goto('/');
  await expect.poll(()=>page.evaluate(async()=>Boolean(await caches.match(new URL('docs/documentation.html',location.href).href)))).toBe(true);
  await expect.poll(()=>page.evaluate(async()=>Boolean(await caches.match(new URL('docs/images/portfolio.png',location.href).href)))).toBe(true);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.goto('/docs/documentation.html');
  await expect(page.getByRole('heading',{name:'How Anonfolio works',exact:true})).toBeVisible();
  await page.locator('.screenshot').scrollIntoViewIfNeeded();
  await expect.poll(()=>page.locator('.screenshot').evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('tab',{name:'Direct HTTPS · explicit',exact:true}).click();
  await expect(page.locator('#https-route')).toBeVisible();
});
