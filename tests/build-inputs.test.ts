import { expect, test } from 'bun:test';
import { cp, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

test('the Docker builder COPY inputs produce the complete static application and guide', async () => {
  const root = resolve(import.meta.dir, '..');
  const stage = await mkdtemp(resolve(tmpdir(), 'anonfolio-docker-inputs-'));
  try {
    // Exercise exactly the declared builder inputs without requiring a daemon.
    const dockerfile = await readFile(resolve(root, 'Dockerfile'), 'utf8');
    const builder = dockerfile.split(/^FROM /m)[1]!;
    for (const line of builder.split('\n').filter(line => line.startsWith('COPY '))) {
      const parts = line.slice(5).trim().split(/\s+/), destination = parts.pop()!;
      for (const source of parts) {
        const target = destination === './' ? resolve(stage, source) : resolve(stage, destination);
        await cp(resolve(root, source), target, { recursive: true });
      }
    }
    await symlink(resolve(root, 'node_modules'), resolve(stage, 'node_modules'), 'junction');
    const build = Bun.spawn([process.execPath, 'run', 'build'], { cwd: stage, stdout: 'pipe', stderr: 'pipe' });
    const [output, errors, code] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
    if (code) throw new Error(output + errors);
    expect(await Bun.file(resolve(stage, 'dist/index.html')).exists()).toBe(true);
    expect(await Bun.file(resolve(stage, 'dist/docs/documentation.html')).text()).toContain('Startup and the refresh lifecycle');
    expect((await Bun.file(resolve(stage, 'dist/docs/images/portfolio.png')).size)).toBeGreaterThan(0);
  } finally { await rm(stage, { recursive: true, force: true }); }
}, 30_000);
