import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { kubo } from '../scripts/ipfs';

const cid = 'bafybeicoxitkxyjqe5asjulkbnjcdybsvrblup7jz5sz5yzdcfq4skez6y';
const car = new Uint8Array([0, 1, 127, 128, 255, 13, 10]);
async function fixture(run: (value: { node: ReturnType<typeof kubo>; root: string; output: string; calls: () => Promise<string[][]> }) => Promise<void>, failExport = false) {
  const root = await mkdtemp(resolve(tmpdir(), 'anonfolio ipfs paths with spaces '));
  try {
    const bin = resolve(root, 'empty-bin');
    await mkdir(bin);
    const script = resolve(root, 'fake kubo.ts');
    const log = resolve(root, 'commands.jsonl');
    await writeFile(script, `
      import { appendFileSync } from 'node:fs';
      const args = process.argv.slice(2);
      appendFileSync(process.env.KUBO_TEST_LOG!, JSON.stringify(args) + '\\n');
      if (args[0] === 'add') console.log(${JSON.stringify(cid)});
      else if (args[0] === 'dag' && args[1] === 'export') {
        process.stdout.write(new Uint8Array(${JSON.stringify([...car])}));
        if (${failExport}) { console.error('injected export failure'); process.exitCode = 1; }
      } else throw new Error('Unexpected Kubo command');
    `);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'));
    const node = kubo([process.execPath, script], root, { ...env, PATH: bin, KUBO_TEST_LOG: log });
    await run({ node, root, output: resolve(root, 'CAR output with spaces'), calls: async () => (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('shell-free IPFS publishing and binary CAR export work without sh or commands in PATH', async () => {
  await fixture(async ({ node, root, output, calls }) => {
    const directory = resolve(root, 'site with spaces');
    expect(await node.publish(cid, '/ip4/127.0.0.1/tcp/5001', directory)).toBe(cid);
    expect(await node.exportCar(cid, directory, output)).toBe(cid);
    expect(new Uint8Array(await readFile(resolve(output, 'anonfolio.car')))).toEqual(car);
    expect(await readFile(resolve(output, 'ipfs-cid.txt'), 'utf8')).toBe(cid + '\n');
    expect(await calls()).toEqual([
      ['add', '--api', '/ip4/127.0.0.1/tcp/5001', '--cid-version', '1', '--pin=true', '--quieter', '--recursive', directory],
      ['add', '--cid-version', '1', '--quieter', '--recursive', directory], ['dag', 'export', cid],
    ]);
    expect((await readdir(output)).sort()).toEqual(['anonfolio.car', 'ipfs-cid.txt']);
  });
});
test('CID mismatches reject publishing and prevent CAR export', async () => {
  await fixture(async ({ node, root, output, calls }) => {
    await expect(node.publish('different-cid', '/ip4/127.0.0.1/tcp/5001', root)).rejects.toThrow('does not match build CID');
    await expect(node.exportCar('different-cid', root, output)).rejects.toThrow('IPFS CID mismatch');
    expect((await calls()).some(args => args[0] === 'dag')).toBe(false);
    expect(await Bun.file(resolve(output, 'anonfolio.car')).exists()).toBe(false);
  });
});
test('a failed binary export keeps the previous CAR and CID and removes temporary files', async () => {
  await fixture(async ({ node, root, output }) => {
    await mkdir(output);
    await writeFile(resolve(output, 'anonfolio.car'), 'previous CAR');
    await writeFile(resolve(output, 'ipfs-cid.txt'), 'previous CID\n');
    await expect(node.exportCar(cid, root, output)).rejects.toThrow('injected export failure');
    expect(await readFile(resolve(output, 'anonfolio.car'), 'utf8')).toBe('previous CAR');
    expect(await readFile(resolve(output, 'ipfs-cid.txt'), 'utf8')).toBe('previous CID\n');
    expect((await readdir(output)).sort()).toEqual(['anonfolio.car', 'ipfs-cid.txt']);
  }, true);
});
