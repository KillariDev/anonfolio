import { mkdir, open, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

// Argument arrays invoke Kubo directly on Windows, macOS and Linux. The Docker
// image keeps its Linux shell entry points; local checks need only Bun and Kubo.
export function kubo(command: readonly string[], cwd: string, env: Record<string, string | undefined>) {
  async function run(args: string[]) {
    const child = Bun.spawn([...command, ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error('Kubo ' + args[0] + ' failed:\n' + stdout + stderr);
    return stdout.trim();
  }
  async function publish(expected: string, api: string, directory: string) {
    const actual = await run(['add', '--api', api, '--cid-version', '1', '--pin=true', '--quieter', '--recursive', directory]);
    if (actual !== expected) throw new Error('Published CID ' + actual + ' does not match build CID ' + expected + '.');
    return actual;
  }
  async function exportCar(expected: string, directory: string, output: string) {
    const actual = await run(['add', '--cid-version', '1', '--quieter', '--recursive', directory]);
    if (actual !== expected) throw new Error('IPFS CID mismatch: build contains ' + expected + ' but CAR was built from ' + actual);
    await mkdir(output, { recursive: true });
    const temporary = resolve(output, '.anonfolio-' + crypto.randomUUID());
    try {
      // CAR is binary. Stream stdout to a file without decoding it as text or
      // using shell redirection, and never replace a good CAR with partial bytes.
      const file = await open(temporary + '.car', 'w');
      try {
        const child = Bun.spawn([...command, 'dag', 'export', actual], { cwd, env, stdout: file.fd, stderr: 'pipe' });
        const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
        if (code !== 0) throw new Error('Kubo dag export failed:\n' + stderr);
      } finally { await file.close(); } // Windows must release the handle before rename.
      await Bun.write(temporary + '.txt', actual + '\n');
      await rename(temporary + '.car', resolve(output, 'anonfolio.car'));
      await rename(temporary + '.txt', resolve(output, 'ipfs-cid.txt'));
      return actual;
    } finally {
      await Promise.all([rm(temporary + '.car', { force: true }), rm(temporary + '.txt', { force: true })]);
    }
  }
  return { publish, exportCar };
}
