import { expect, test } from 'bun:test';
import { Trie } from '@ethereumjs/trie';
import { bytesToHex, hexToBytes, keccak256, padHex, toRlp, type Hex } from 'viem';
import { verifyAccountResponse, verifyCode, assertPinnedBlock } from '../src/verification/proofs';
import { privateExecutionRpc, type RpcRequest } from '../src/verification/transport';
import { checkCheckpointAge, CHECKPOINT_TIME, HELIOS_WASM_SHA256 } from '../src/verification/trust';
const a = '0x0000000000000000000000000000000000000001' as Hex;
const b = '0x0000000000000000000000000000000000000002' as Hex;
async function fixture() {
  const code = '0x60005460005260206000f3' as Hex;
  const storage = new Trie({ useKeyHashing: true });
  const slot = padHex('0x00', { size: 32 });
  await storage.put(hexToBytes(slot), hexToBytes(toRlp('0x2a')));
  const state = new Trie({ useKeyHashing: true });
  await state.put(hexToBytes(a), hexToBytes(toRlp(['0x', '0x05', bytesToHex(storage.root()), keccak256(code)])));
  const block = { hash: '0x' + '11'.repeat(32), number: '0x100', timestamp: Date.now() - 60_000, stateRoot: bytesToHex(state.root()) };
  const proof = { address: a, nonce: '0x0', balance: '0x5', codeHash: keccak256(code), storageHash: bytesToHex(storage.root()),
    accountProof: (await state.createProof(hexToBytes(a))).map(value => bytesToHex(value)),
    storageProof: [{ key: slot, value: '0x2a', proof: (await storage.createProof(hexToBytes(slot))).map(value => bytesToHex(value)) }] };
  return { code, slot, block, proof };
}
test('genuine account and nonzero storage proofs verify against the pinned state root', async () => {
  const { block, proof, slot, code } = await fixture();
  expect(await verifyAccountResponse(a, [slot], block, proof)).toBe(keccak256(code));
  expect(() => verifyCode(code, proof.codeHash)).not.toThrow();
});
test('a valid proof for the wrong wallet is rejected (Helios PR #813 regression)', async () => {
  const { block, proof } = await fixture();
  await expect(verifyAccountResponse(b, [], block, proof)).rejects.toThrow('different requested address');
});
test('a valid account proof for another block root and a request for another block are rejected', async () => {
  const { block, proof } = await fixture();
  await expect(verifyAccountResponse(a, [], { ...block, stateRoot: '0x' + '22'.repeat(32) }, proof)).rejects.toThrow();
  expect(() => assertPinnedBlock({ blockHash: '0x' + '33'.repeat(32) }, block)).toThrow();
  expect(() => assertPinnedBlock('latest', block)).toThrow();
  expect(() => assertPinnedBlock({ blockHash: block.hash }, block)).not.toThrow();
});
test('omitting a requested nonzero storage slot never proves a zero value', async () => {
  const { block, proof, slot } = await fixture();
  await expect(verifyAccountResponse(a, [slot], block, { ...proof, storageProof: [] })).rejects.toThrow('Missing requested');
  const forged = structuredClone(proof);
  forged.storageProof[0]!.value = '0x0';
  await expect(verifyAccountResponse(a, [slot], block, forged)).rejects.toThrow('Storage proof value mismatch');
});
test('tampered bytecode cannot execute under a genuine account code hash', async () => {
  const { proof } = await fixture();
  expect(() => verifyCode('0x60006000f3', proof.codeHash)).toThrow('Bytecode hash');
});
test('wallet proofs/code and retries cannot escape worker.fetch or change isolation keys', async () => {
  const original = globalThis.fetch;
  const calls: any[] = [];
  globalThis.fetch = (() => { throw new Error('ordinary fetch forbidden'); }) as unknown as typeof fetch;
  try {
    let fail = true;
    const worker = { fetch: async (url: any, init: any) => {
      calls.push({ url, key: init.anonOptions.isolationKey, body: JSON.parse(init.body) });
      if (fail) throw new Error('Tor unavailable');
      return Response.json({ jsonrpc: '2.0', id: 1, result: '0x' });
    } };
    const wallet = { rpcUrl: 'https://one.example/', isolationKey: 'wallet-one' };
    const body: RpcRequest = { jsonrpc: '2.0', id: 1, method: 'eth_getProof', params: [a, [], { blockHash: '0x' + '11'.repeat(32) }] };
    await expect(privateExecutionRpc(worker, wallet, body)).rejects.toThrow('Tor unavailable');
    fail = false;
    await privateExecutionRpc(worker, wallet, body);
    await privateExecutionRpc(worker, { rpcUrl: 'https://two.example/', isolationKey: 'wallet-two' }, { ...body, params: [b, [], body.params[2]] });
    expect(calls.map(call => call.key)).toEqual(['wallet-one', 'wallet-one', 'wallet-two']);
    expect(calls.every(call => !Array.isArray(call.body))).toBe(true);
    await expect(privateExecutionRpc(worker, wallet, { ...body, method: 'eth_getBalance' })).rejects.toThrow('Disallowed');
  } finally { globalThis.fetch = original; }
});
test('the pinned WASM bytes are exact and expired weak-subjectivity checkpoints fail closed', async () => {
  const bytes = await Bun.file(new URL('../vendor/helios/index_bg.wasm', import.meta.url)).arrayBuffer();
  expect(new Bun.CryptoHasher('sha256').update(bytes).digest('hex')).toBe(HELIOS_WASM_SHA256);
  expect(() => checkCheckpointAge(CHECKPOINT_TIME + 15 * 86400_000)).toThrow('trust window');
  expect(() => checkCheckpointAge(CHECKPOINT_TIME + 60_000)).not.toThrow();
});

test('a genuine absence proof distinguishes proven zero from an unavailable lookup', async () => {
  const { block, proof } = await fixture();
  const empty = keccak256(toRlp('0x'));
  // The account-A leaf also proves account B is absent in this single-leaf trie.
  const absent = { ...proof, address: b, nonce: '0x0', balance: '0x0', storageHash: empty, codeHash: keccak256('0x'), storageProof: [] };
  expect(await verifyAccountResponse(b, [], block, absent)).toBe(keccak256('0x'));
  const zeros = ('0x' + '00'.repeat(32)) as Hex;
  expect(await verifyAccountResponse(b, [], block, { ...absent, storageHash: zeros, codeHash: zeros })).toBe(zeros);
  await expect(verifyAccountResponse(b, [], block, { ...absent, balance: '0x1' })).rejects.toThrow();
});

import { assertTorWorkerHash, TOR_WORKER_HASH } from '../src/config';
test('a substituted on-chain Tor worker digest cannot replace the reviewed binary', () => {
  expect(() => assertTorWorkerHash(TOR_WORKER_HASH)).not.toThrow();
  expect(() => assertTorWorkerHash('0x' + '00'.repeat(32))).toThrow('reviewed pin');
});
