import { mkdir, rename, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Run hourly beside your gateway, or copy its archive into the release job.
// Publishing a manifest never authenticates a consensus: Arti does that.
export async function publishTorBootstrap(source: string, destination = 'public') {
  const file = Bun.file(source), metadata = await stat(source);
  if (!metadata.isFile() || metadata.size > 8 * 1024 * 1024 || metadata.size < 4) throw new Error('Expected a Tor bootstrap archive smaller than 8 MiB.');
  if (Date.now() - metadata.mtimeMs > 6 * 60 * 60 * 1000 || metadata.mtimeMs > Date.now() + 60_000) throw new Error('Bootstrap archive must have been updated within six hours.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] !== 0x28 || bytes[1] !== 0xb5 || bytes[2] !== 0x2f || bytes[3] !== 0xfd) throw new Error('Expected a zstd bootstrap.zip.zst archive.');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const archive = 'tor-bootstrap-' + sha256 + '.zip.zst';
  const target = resolve(destination); await mkdir(target, { recursive: true });
  await Bun.write(resolve(target, archive), bytes);
  const manifest = { version: 1, updatedAt: Math.floor(metadata.mtimeMs), archive, sha256 };
  const temporary = resolve(target, '.tor-bootstrap-' + crypto.randomUUID() + '.json');
  await Bun.write(temporary, JSON.stringify(manifest) + '\n');
  await rename(temporary, resolve(target, 'tor-bootstrap.json'));
  return manifest;
}
if (import.meta.main) {
  const source = process.argv[2] || process.env.TOR_BOOTSTRAP_SOURCE;
  if (!source) throw new Error('Usage: bun run bootstrap:update /path/to/gateway/data/bootstrap.zip.zst [output-directory=public]');
  const manifest = await publishTorBootstrap(source, process.argv[3]);
  console.log('Published Tor bootstrap mirror: ' + manifest.archive);
}
