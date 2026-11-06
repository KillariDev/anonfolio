import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { kubo } from './ipfs';

// Use a real, isolated Kubo repository. Never alter the operator's running node.
const ipfs = Bun.which(process.env.IPFS_BIN || 'ipfs');
if (!ipfs) throw new Error('Install Kubo (tested with v0.25.0), or set IPFS_BIN to its executable, then run bun run test:ipfs.');
const root = resolve(import.meta.dir, '..');
const temporary = await mkdtemp(resolve(tmpdir(), 'anonfolio-ipfs-'));
const env = { ...process.env, IPFS_PATH: resolve(temporary, 'repo') };
const node = kubo([ipfs], root, env);
async function run(command: string[], variables: Record<string, string | undefined> = env) {
  const process = Bun.spawn(command, { cwd: root, env: variables, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (code !== 0) throw new Error(command[0] + ' failed:\n' + stdout + stderr);
  return stdout.trim();
}
function freePort() {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = server.port!; server.stop(true); return port;
}
let daemon: ReturnType<typeof Bun.spawn> | undefined;
try {
  console.log(await run([process.execPath, 'run', 'build']));
  await run([ipfs, 'init', '--profile=test']);
  const apiPort = freePort();
  const gatewayPort = freePort();
  const api = '/ip4/127.0.0.1/tcp/' + apiPort;
  await run([ipfs, 'config', 'Addresses.API', api]);
  await run([ipfs, 'config', 'Addresses.Gateway', '/ip4/127.0.0.1/tcp/' + gatewayPort]);
  const cid = await run([ipfs, 'add', '--cid-version', '1', '--quieter', '--only-hash', '--recursive', 'dist']);
  const exportDirectory = resolve(root, 'dist');
  daemon = Bun.spawn([ipfs, 'daemon', '--offline'], { env, stdout: 'ignore', stderr: 'inherit' });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (daemon.exitCode !== null) throw new Error('Kubo exited before its API became ready.');
    try {
      const response = await fetch('http://127.0.0.1:' + apiPort + '/api/v0/id', { method: 'POST', signal: AbortSignal.timeout(500) });
      if (response.ok) { ready = true; break; }
    } catch { /* daemon is still starting */ }
    await Bun.sleep(100);
  }
  if (!ready) throw new Error('Kubo API did not become ready.');
  console.log('Published CID: ' + await node.publish(cid, api, exportDirectory));
  // Exercise the fail-closed CID check against the real publisher as well.
  let mismatchRejected = false;
  try { await node.publish('unexpected-cid', api, exportDirectory); }
  catch (error) { mismatchRejected = String(error).includes('does not match build CID'); }
  if (!mismatchRejected) throw new Error('Publisher accepted a mismatched CID.');
  const artifactDir = resolve(root, 'ipfs-artifacts');
  console.log('Exported IPFS artifact: ' + await node.exportCar(cid, exportDirectory, artifactDir));
  // Import into a fresh repository to verify the CAR carries the complete site.
  const importEnv = { ...env, IPFS_PATH: resolve(temporary, 'import-repo') };
  await run([ipfs, 'init', '--profile=test'], importEnv);
  await run([ipfs, 'dag', 'import', resolve(artifactDir, 'anonfolio.car')], importEnv);
  const importedHtml = await run([ipfs, 'cat', cid + '/index.html'], importEnv);
  if (importedHtml !== (await Bun.file(resolve(root, 'dist/index.html')).text()).trim()) throw new Error('CAR import did not reproduce the built page.');
  const pathUrl = 'http://127.0.0.1:' + gatewayPort + '/ipfs/' + cid + '/';
  const subdomainUrl = 'http://' + cid + '.ipfs.localhost:' + gatewayPort + '/';
  console.log('Testing IPFS gateways:\n' + pathUrl + '\n' + subdomainUrl);
  const browser = Bun.spawn([process.execPath, 'run', 'test:browser', '--grep', 'IPFS gateway|live mainnet'], {
    cwd: root, env: { ...env, IPFS_GATEWAY_URL: pathUrl, IPFS_SUBDOMAIN_URL: subdomainUrl }, stdout: 'inherit', stderr: 'inherit',
  });
  const result = await browser.exited;
  if (result !== 0) throw new Error('IPFS browser checks failed.');
  console.log('Verified CID: ' + cid + '\nCAR and CID saved in ipfs-artifacts/. The temporary gateway is now stopping.');
} finally {
  if (daemon) { daemon.kill(); await daemon.exited; }
  await rm(temporary, { recursive: true, force: true });
}
