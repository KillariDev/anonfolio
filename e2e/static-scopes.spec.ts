import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Serve real build bytes below multiple application scopes on one origin, as
// an IPFS path gateway does. Only the worker's release version is varied.
async function gateway() {
  const root = resolve('dist');
  const releases = new Map<string, string>();
  const server = createServer(async (request, response) => {
    const match = new URL(request.url || '/', 'http://localhost').pathname.match(/^\/(ipfs\/release-a\/-child|ipfs\/release-[ab]|docs\/portfolio)\/(.*)$/);
    if (!match) { response.writeHead(404).end(); return; }
    const path = resolve(root, match[2] || 'index.html');
    if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    try {
      let bytes = await readFile(path);
      if (match[2] === 'sw.js') bytes = Buffer.from(bytes.toString().replace(/const CACHE = CACHE_PREFIX \+ "[a-f0-9]+";/, 'const CACHE = CACHE_PREFIX + "' + (releases.get(match[1]!) || match[1]) + '";'));
      const extension = path.split('.').at(-1)!;
      const types: Record<string, string> = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', wasm: 'application/wasm' };
      response.writeHead(200, { 'Content-Type': types[extension] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return { releases, origin: 'http://127.0.0.1:' + address.port, close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }) };
}
async function ready(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  // A nested page can initially be controlled by its parent's worker.
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(new URL('sw.js?mode=https', url).href);
}
test.beforeEach(async ({ context }) => {
  test.skip(!process.env.BASE_URL, 'Production service-worker scopes.');
  await context.addInitScript(() => localStorage.setItem('anonfolio.network.v1', JSON.stringify({ mode: 'https', rpcUrls: ['https://execution.example/'], gateways: ['152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ'] })));
});

test('static build IPFS releases keep independent offline caches on the same gateway', async ({ page, context }) => {
  const host = await gateway();
  try {
    await ready(page, host.origin + '/ipfs/release-a/');
    const other = await context.newPage();
    await ready(other, host.origin + '/ipfs/release-b/');
    const nested = await context.newPage();
    await ready(nested, host.origin + '/ipfs/release-a/-child/');
    expect((await page.evaluate(() => caches.keys())).filter(key => key.startsWith('anonfolio-shell-'))).toHaveLength(3);
    // Updating A must remove only A's previous cache, preserving B and the nested application.
    host.releases.set('ipfs/release-a', 'updated-a');
    await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration!.update(); });
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter(key => key.endsWith('updated-a')).length)).toBe(1);
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter(key => key.startsWith('anonfolio-shell-')).length)).toBe(3);
    await context.setOffline(true);
    for (const tab of [page, other, nested]) {
      await tab.reload();
      await expect(tab.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
      await expect(tab.locator('.brand-mark')).toBeVisible();
    }
  } finally { await context.setOffline(false); await host.close(); }
});

test('static build caches its shell when the application base includes docs', async ({ page, context }) => {
  const host = await gateway();
  try {
    await ready(page, host.origin + '/docs/portfolio/');
    expect(await page.evaluate(async () => Boolean(await caches.match(new URL('./', location.href).href)))).toBe(true);
    expect(await page.evaluate(async () => Boolean(await caches.match(new URL('docs/documentation.html', location.href).href)))).toBe(false);
    const worker = context.serviceWorkers()[0]!;
    await worker.evaluate(() => {
      const original = globalThis.fetch;
      (self as any).__offline = false;
      globalThis.fetch = ((request: RequestInfo | URL, init?: RequestInit) => request instanceof Request && request.mode === 'navigate'
        ? (self as any).__offline ? Promise.reject(new Error('Offline')) : Promise.resolve(new Response('<h1>Next release</h1>', { headers: { 'content-type': 'text/html' } }))
        : original(request, init)) as typeof fetch;
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Next release', exact: true })).toBeVisible();
    await worker.evaluate(() => { (self as any).__offline = true; });
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
  } finally { await context.setOffline(false); await host.close(); }
});
