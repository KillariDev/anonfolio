import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let directory: string;
let server: ReturnType<typeof Bun.spawn>;
let baseUrl: string;
const html = '<!doctype html><title>Static fixture</title>';
const script = new URL('../scripts/serve.ts', import.meta.url).pathname;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'anonfolio-serve-'));
  await mkdir(join(directory, 'dist', 'assets'), { recursive: true });
  await writeFile(join(directory, 'dist', 'index.html'), html);
  await writeFile(join(directory, 'dist', 'assets', 'app.js'), 'console.log("fixture")');
  await writeFile(join(directory, 'secret.txt'), 'private fixture');
  server = Bun.spawn([process.execPath, script], {
    cwd: directory,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
    stdout: 'pipe', stderr: 'pipe',
  });
  const reader = (server.stdout as ReadableStream<Uint8Array>).getReader();
  let output = '';
  const deadline = setTimeout(() => { void reader.cancel(); }, 5000);
  try {
    while (!output.includes('http://')) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Static server did not start: ' + output);
      output += new TextDecoder().decode(value);
    }
    baseUrl = output.match(/http:\/\/[^\s]+/)![0].replace(/\/$/, '');
  } finally {
    clearTimeout(deadline);
    reader.releaseLock();
  }
});
afterAll(async () => {
  server?.kill();
  if (server) await server.exited;
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('serves the production root and assets with correct types and privacy headers', async () => {
  const response = await fetch(baseUrl);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/html');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(await response.text()).toBe(html);
  const asset = await fetch(baseUrl + '/assets/app.js');
  expect(asset.status).toBe(200);
  expect(asset.headers.get('content-type')).toContain('javascript');
  expect(await asset.text()).toBe('console.log("fixture")');
});

test('HEAD sends the GET content length without a body', async () => {
  const response = await fetch(baseUrl, { method: 'HEAD' });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(html)));
  expect(await response.text()).toBe('');
});

test('missing assets return 404 instead of HTML', async () => {
  expect((await fetch(baseUrl + '/missing.js')).status).toBe(404);
});

test('rejects writes, malformed paths and encoded directory traversal', async () => {
  expect((await fetch(baseUrl, { method: 'POST', body: 'data' })).status).toBe(405);
  expect((await fetch(baseUrl + '/%zz')).status).toBe(400);
  const traversal = await fetch(baseUrl + '/%2e%2e%2fsecret.txt');
  expect(traversal.status).toBe(403);
  expect(await traversal.text()).not.toContain('private fixture');
});

test('fails with an actionable message when dist has not been built', async () => {
  const child = Bun.spawn([process.execPath, script], {
    cwd: join(directory, 'dist', 'assets'), stdout: 'pipe', stderr: 'pipe',
  });
  expect(await child.exited).not.toBe(0);
  expect(await new Response(child.stderr).text()).toContain('Run bun run build first');
});
