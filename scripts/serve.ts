import { resolve, sep } from 'node:path';
const root = resolve('dist');
if (!(await Bun.file(resolve(root, 'index.html')).exists())) {
  throw new Error('Missing dist/index.html. Run bun run build first.');
}
const server = Bun.serve({
  hostname: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 4173),
  async fetch(request) {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(request.url).pathname); }
    catch { return new Response('Bad request', { status: 400 }); }
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root + sep)) return new Response('Forbidden', { status: 403 });
    const file = Bun.file(path);
    if (!(await file.exists())) return new Response('Not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : file, {
      headers: { 'Content-Type': file.type, 'Content-Length': String(file.size), 'Cache-Control': 'no-cache', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' },
    });
  },
});
console.log('Anonfolio available at ' + server.url);
