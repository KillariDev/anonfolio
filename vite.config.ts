import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const torWorkerBytes = readFileSync(new URL('./vendor/tor/anon-rpc-worker.js', import.meta.url));
const documentation = readFileSync(new URL('./docs/documentation.html', import.meta.url), 'utf8');
const documentationImage = readFileSync(new URL('./docs/images/portfolio.png', import.meta.url));
const presentation = readFileSync(new URL('./docs/presentation.html', import.meta.url), 'utf8');
const presentationPdf = readFileSync(new URL('./docs/presentation.pdf', import.meta.url));

// Cache only built application files, never RPC or worker/gateway traffic.
export default defineConfig({
  // Resolve assets beneath both subdomain gateways and /ipfs/<CID>/ paths.
  base: './',
  // The trie dependency inspects process?.env.DEBUG inside browser workers.
  // Match the production browser environment during Vite development too.
  define: { 'process.env': {} },
  optimizeDeps: { include: ['@ethereumjs/trie'], esbuildOptions: { define: { 'process.env': '{}' } } },
  worker: { format: 'es' },
  resolve: { alias: { events: 'events/', buffer: 'buffer/' } },
  plugins: [{
    name: 'unchanged-tor-worker',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url || '/', 'http://localhost');
        // Vite still handles the ?url module import. The resulting asset URL
        // must return the reviewed bytes without transformation or source maps.
        if (url.pathname !== '/vendor/tor/anon-rpc-worker.js' || url.searchParams.has('url')) return next();
        if (request.method !== 'GET' && request.method !== 'HEAD') { response.statusCode = 405; response.end(); return; }
        response.setHeader('Content-Type', 'text/javascript');
        response.setHeader('Content-Length', torWorkerBytes.byteLength);
        response.setHeader('Cache-Control', 'no-cache');
        response.end(request.method === 'HEAD' ? undefined : torWorkerBytes);
      });
    },
  }, {
    name: 'standalone-documentation',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'docs/documentation.html', source: documentation });
      this.emitFile({ type: 'asset', fileName: 'docs/images/portfolio.png', source: documentationImage });
      this.emitFile({ type: 'asset', fileName: 'docs/presentation.html', source: presentation });
      this.emitFile({ type: 'asset', fileName: 'docs/presentation.pdf', source: presentationPdf });
    },
  }, {
    name: 'offline-application-shell',
    enforce: 'post',
    generateBundle(_, bundle) {
      const paths = [...Object.keys(bundle).filter(path => /\.(html|js|css|png|jpg|jpeg|svg|webp|wasm|pdf)$/.test(path)), './'];
      const version = createHash('sha256').update(JSON.stringify(paths)).update(documentation).update(documentationImage).update(presentation).update(presentationPdf).digest('hex').slice(0, 16);
      // A raw colon cannot occur in an encoded scope, preventing prefix
      // collisions even for nested applications on an IPFS path gateway.
      this.emitFile({
        type: 'asset', fileName: 'sw.js',
        source: 'const CACHE_PREFIX = "anonfolio-shell-" + encodeURIComponent(self.registration.scope) + ":";\nconst CACHE = CACHE_PREFIX + "' + version + '";\nconst PATHS = ' + JSON.stringify(paths) + ';\n' + `
const urls = PATHS.map(path => new URL(path, self.registration.scope).href);
// Saved portfolios need only the UI. Verifier runtimes and documentation are
// cached when requested, so an optional download cannot block installation.
const essential = urls.filter(url => {
  const path = url.slice(self.registration.scope.length), name = path.split('/').at(-1);
  return !path.startsWith('docs/') && !name.endsWith('.wasm') && !name.endsWith('.pdf')
    && !name.startsWith('anon-rpc-worker-') && !name.startsWith('helios.worker-');
});
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(essential)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  // Navigation requests can retain #slide fragments; they identify a position
  // within the same cached file, not another resource or an RPC destination.
  const resource = new URL(event.request.url); resource.hash = '';
  const key = resource.href;
  if (event.request.method !== 'GET' || !urls.includes(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key);
    if (event.request.mode !== 'navigate' && cached) return cached;
    // A slow or failing host must not hide an already cached page indefinitely.
    const controller = new AbortController();
    const timer = cached && event.request.mode === 'navigate' ? setTimeout(() => controller.abort(), 3000) : undefined;
    try {
      const response = await fetch(event.request, { signal: controller.signal });
      if (!response.ok && cached) return cached;
      // Keep installed app HTML paired with its cached release assets. A new
      // service-worker installation replaces both together after deployment.
      const appNavigation = event.request.mode === 'navigate' && !key.slice(self.registration.scope.length).startsWith('docs/');
      if (response.ok && (!appNavigation || !cached)) event.waitUntil(cache.put(key, response.clone()).catch(() => {}));
      return response;
    } catch (error) {
      return cached || Response.error();
    } finally { clearTimeout(timer); }
  })());
});
`,
      });
    },
  }],
});
