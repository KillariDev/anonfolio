import { createHash } from 'node:crypto';
import { defineConfig } from 'vite';

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
    name: 'offline-application-shell',
    enforce: 'post',
    generateBundle(_, bundle) {
      const paths = [...Object.keys(bundle).filter(path => /\.(html|js|css|png|jpg|jpeg|svg|webp|wasm)$/.test(path)), './'];
      const version = createHash('sha256').update(JSON.stringify(paths)).digest('hex').slice(0, 16);
      this.emitFile({
        type: 'asset', fileName: 'sw.js',
        source: 'const CACHE = "anonfolio-shell-' + version + '";\nconst PATHS = ' + JSON.stringify(paths) + ';\n' + `
const urls = PATHS.map(path => new URL(path, self.registration.scope).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(urls)).then(() => self.skipWaiting()));
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
