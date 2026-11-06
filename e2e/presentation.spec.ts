import { expect, test } from '@playwright/test';
import { copyFile, readFile } from 'node:fs/promises';

for (const width of [1280, 768, 390]) test(`technical presentation navigates every slide without clipping at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 960 });
  const requests: string[] = [], errors: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('data:') && new URL(request.url()).origin !== new URL(process.env.BASE_URL || 'http://127.0.0.1:5173').origin) requests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/docs/presentation.html');
  await expect(page.locator('.slide')).toHaveCount(16);
  await expect(page.locator('.slide:visible')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: /Private requests/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous slide', exact: true })).toBeDisabled();
  const ids = await page.locator('.slide').evaluateAll(slides => slides.map(slide => slide.id));
  for (const id of ids) {
    await page.getByLabel('Choose slide').selectOption(id);
    const slide = page.locator('#' + id);
    await expect(slide).toBeVisible();
    await expect.poll(() => slide.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
    const overflow = await slide.evaluate(node => ({ vertical: node.scrollHeight > node.clientHeight + 2, horizontal: node.scrollWidth > node.clientWidth + 2 }));
    expect(overflow, id).toEqual({ vertical: false, horizontal: false });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), id).toBe(true);
    await expect(page.locator('.notes:visible')).toHaveCount(0);
    if (id === 'message-roundtrip') {
      if (width < 600) { await expect(slide.locator('.mobile-sequence')).toBeVisible(); await expect(slide.locator('.diagram')).toBeHidden(); }
      else { await expect(slide.locator('.diagram')).toBeVisible(); await expect(slide.locator('.mobile-sequence')).toBeHidden(); }
    }
    if (['overview', 'technologies', 'message-roundtrip', 'token-execution', 'concurrency-cache'].includes(id)) await page.screenshot({ path: test.info().outputPath(`${id}-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  await expect(page.getByRole('button', { name: 'Next slide', exact: true })).toBeDisabled();
  await page.locator('#title-engineering').press('Home');
  await expect(page.locator('#overview')).toBeVisible();
  await page.locator('#title-overview').press('ArrowRight');
  await expect(page.locator('#product')).toBeVisible();
  await page.locator('#title-product').press('PageDown');
  await expect(page.locator('#trust-model')).toBeVisible();
  await page.locator('#title-trust-model').press('n');
  await expect(page.locator('#trust-model .notes')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notes', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'All slides', exact: true }).click();
  await expect(page.locator('.slide:visible')).toHaveCount(16);
  expect(await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
    return ids.length === new Set(ids).size && [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')].every(link => document.getElementById(link.hash.slice(1)));
  })).toBe(true);
  expect(requests).toEqual([]); expect(errors).toEqual([]);
  expect(page.workers()).toHaveLength(0);
});

test('self-contained presentation opens from disk, deep-links, prints every slide and remains readable without JavaScript', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage(), requests: string[] = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await page.goto(new URL('../docs/presentation.html#message-roundtrip', import.meta.url).href);
    await expect(page.locator('#message-roundtrip')).toBeVisible();
    await expect(page.locator('.slide:visible')).toHaveCount(1);
    await page.getByRole('button', { name: 'Next slide', exact: true }).click();
    await expect(page).toHaveURL(/#network-route$/);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.slide:visible')).toHaveCount(16);
    await expect(page.locator('.notes:visible')).toHaveCount(0);
    await expect(page.locator('.masthead')).toBeHidden();
    const pdf = test.info().outputPath('anonfolio-technical-presentation.pdf');
    await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
    const bytes = await readFile(pdf);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(16);
    if (process.env.UPDATE_PRESENTATION_PDF === '1') await copyFile(pdf, new URL('../docs/presentation.pdf', import.meta.url));
    expect(requests).toEqual([]);
    await page.emulateMedia({ media: 'screen' });
    await expect(page.locator('.slide:visible')).toHaveCount(1);
  } finally { await context.close(); }
  const noJS = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await noJS.newPage();
    await page.goto(new URL('../docs/presentation.html', import.meta.url).href);
    await expect(page.locator('.slide:visible')).toHaveCount(16);
    await expect(page.locator('#token-execution')).toContainText('Proxy-aware execution');
    await expect(page.locator('#eth-proof')).toContainText('eth_getProof');
    await expect(page.locator('#network-route')).toContainText('KPS gateway');
    await expect(page.locator('#concurrency-cache')).toContainText('one successful pool lookup');
    await expect(page.locator('.deck-controls')).toBeHidden();
    await page.locator('.screenshot').scrollIntoViewIfNeeded();
    await expect.poll(() => page.locator('.screenshot').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  } finally { await noJS.close(); }
});

test('static build presentation is cached with the application and works offline', async ({ page, context }) => {
  test.skip(!process.env.BASE_URL, 'Production offline shell check.');
  await page.addInitScript(() => localStorage.setItem('anonfolio.network.v1', JSON.stringify({ mode: 'https', rpcUrls: ['https://execution.example/'], gateways: ['152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ'] })));
  await page.goto('/');
  await page.evaluate(async()=>{await navigator.serviceWorker.ready; if(!navigator.serviceWorker.controller)await new Promise<void>(resolve=>navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(),{once:true})); await fetch('docs/presentation.html'); await fetch('docs/presentation.pdf');});
  await expect.poll(() => page.evaluate(async () => Boolean(await caches.match(new URL('docs/presentation.html', location.href).href)))).toBe(true);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.goto('/docs/presentation.html#message-roundtrip');
  await expect(page.locator('#message-roundtrip')).toBeVisible();
  await page.getByLabel('Choose slide').selectOption('product');
  await expect.poll(() => page.locator('.screenshot').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await expect(page.locator('#product .notes')).toBeVisible();
  expect(await page.evaluate(async () => (await (await fetch('presentation.pdf')).text()).startsWith('%PDF-'))).toBe(true);
  await context.setOffline(false);
});
