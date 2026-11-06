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
      this.emitFile({
        type: 'asset', fileName: 'sw.js',
        source: 'const CACHE = "anonfolio-shell-' + version + '";\nconst PATHS = ' + JSON.stringify(paths) + ';\n' + `
const urls = PATHS.map(path => new URL(path, self.registration.scope).href);
// HTTPS mode does not need the large Tor bundle, even for offline startup.
const eager = new URL(self.location.href).searchParams.get('mode') === 'https' ? urls.filter(url => !url.split('/').at(-1).startsWith('anon-rpc-worker-')) : urls;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(eager)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('anonfolio-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !urls.includes(event.request.url)) return;
  event.respondWith(
    event.request.mode === 'navigate'
      ? fetch(event.request).then(response => {
          if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
          return response;
        }).catch(() => caches.match(event.request).then(response => response || Response.error()))
      : caches.match(event.request).then(response => response || fetch(event.request))
  );
});
`,
      });
    },
  }],
});
