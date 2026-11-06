import { Trie } from '@ethereumjs/trie';
import { fromRlp, hexToBytes, bytesToHex, keccak256, padHex, toRlp, type Hex } from 'viem';
import type { VerifiedBlock } from './trust';
const emptyRoot = keccak256(toRlp('0x'));
const emptyCode = keccak256('0x');
const quantity = (value: string) => BigInt(value) === 0n ? '0x' : (BigInt(value).toString(16).length % 2 ? '0x0' : '0x') + BigInt(value).toString(16);
async function proofValue(root: Hex, key: Hex, nodes: Hex[]) {
  if (!Array.isArray(nodes)) throw new Error('Missing Merkle proof.');
  if (root === emptyRoot && !nodes.length) return null;
  return new Trie().verifyProof(hexToBytes(root), hexToBytes(keccak256(key)), nodes.map(node => hexToBytes(node)));
}
// Defense in depth in front of Helios's independent native proof verifier.
export async function verifyAccountResponse(address: Hex, slots: Hex[], block: VerifiedBlock, proof: any) {
  if (!proof || typeof proof.address !== 'string' || proof.address.toLowerCase() !== address.toLowerCase()) throw new Error('Proof belongs to a different requested address.');
  const actual = await proofValue(block.stateRoot as Hex, address, proof.accountProof);
  const expected = toRlp([quantity(proof.nonce), quantity(proof.balance), proof.storageHash, proof.codeHash] as Hex[]);
  const emptyAccountFields = (proof.storageHash === emptyRoot && proof.codeHash === emptyCode)
    || (proof.storageHash === '0x' + '00'.repeat(32) && proof.codeHash === '0x' + '00'.repeat(32));
  if (actual ? bytesToHex(actual) !== expected : BigInt(proof.balance) !== 0n || BigInt(proof.nonce) !== 0n || !emptyAccountFields) {
    throw new Error('Account proof does not match the verified finalized state root.');
  }
  const entries = new Map<string, any>();
  if (!Array.isArray(proof.storageProof)) throw new Error('Missing storage proofs.');
  for (const entry of proof.storageProof) {
    const slot = padHex(entry.key as Hex, { size: 32 }).toLowerCase();
    if (entries.has(slot)) throw new Error('Duplicate storage proof.');
    const storage = await proofValue(!actual && emptyAccountFields ? emptyRoot : proof.storageHash, slot as Hex, entry.proof);
    const decoded = storage ? fromRlp(bytesToHex(storage)) as Hex : '0x';
    const value = decoded === '0x' ? 0n : BigInt(decoded);
    if (value !== BigInt(entry.value)) throw new Error('Storage proof value mismatch.');
    entries.set(slot, entry);
  }
  for (const slot of slots) if (!entries.has(padHex(slot, { size: 32 }).toLowerCase())) throw new Error('Missing requested storage slot proof.');
  return proof.codeHash as Hex;
}
export function verifyCode(code: Hex, expected: Hex) {
  if (keccak256(code) !== expected) throw new Error('Bytecode hash does not match the verified account.');
}
export function assertPinnedBlock(value: any, block: VerifiedBlock) {
  const hash = typeof value === 'string' ? value : value?.blockHash;
  if (typeof hash !== 'string' || hash.toLowerCase() !== block.hash.toLowerCase()) throw new Error('Execution request escaped the pinned finalized block.');
}
