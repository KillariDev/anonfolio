import { expect, test } from '@playwright/test';
import { keccak256, toRlp } from 'viem';

test('real account proofs verify inside a development browser worker without Node globals', async ({ page }) => {
  test.skip(!!process.env.BASE_URL || !!process.env.IPFS_GATEWAY_URL, 'Loads the Vite source module to exercise development dependency bundling.');
  const address = '0x0000000000000000000000000000000000000001' as const;
  const storageHash = keccak256(toRlp('0x')), codeHash = keccak256('0x');
  const account = toRlp(['0x', '0x05', storageHash, codeHash]);
  const leaf = toRlp([('0x20' + keccak256(address).slice(2)) as `0x${string}`, account]);
  const proof = { address, nonce: '0x0', balance: '0x5', storageHash, codeHash, accountProof: [leaf], storageProof: [] };
  const block = { hash: '0x'+'11'.repeat(32), stateRoot: keccak256(leaf), number: '0x100', timestamp: Date.now() };
  await page.goto('/');
  const result = await page.evaluate(async ({ address, proof, block }) => {
    const url = URL.createObjectURL(new Blob([`
      import { verifyAccountResponse } from '${location.origin}/src/verification/proofs.ts';
      self.onmessage = async event => {
        try { self.postMessage({ hash: await verifyAccountResponse(event.data.address, [], event.data.block, event.data.proof) }); }
        catch (error) { self.postMessage({ error: String(error) }); }
      };
    `], { type: 'text/javascript' }));
    const worker = new Worker(url, { type: 'module' });
    try {
      return await new Promise<any>((resolve, reject) => {
        worker.onmessage = event => resolve(event.data);
        worker.onerror = event => reject(new Error(event.message));
        worker.postMessage({ address, proof, block });
      });
    } finally { worker.terminate(); URL.revokeObjectURL(url); }
  }, { address, proof, block });
  expect(result).toEqual({ hash: codeHash });
});
