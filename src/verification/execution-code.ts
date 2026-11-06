import type { Hex } from 'viem';
import { assertPinnedBlock, verifyAccountResponse } from './proofs';
import type { VerifiedBlock } from './trust';
import type { RpcRequest } from './transport';
import type { VerifiedCodeCache } from './code-cache';

export async function executionCode(body: RpcRequest, block: VerifiedBlock, hashes: Map<string, Hex>, rpc: (body: RpcRequest) => Promise<any>, cache: VerifiedCodeCache) {
  assertPinnedBlock(body.params.at(-1), block);
  const address = body.params[0] as Hex;
  let hash = hashes.get(address.toLowerCase());
  if (!hash) {
    // A previous refresh's account cannot authorize code at this block. Obtain
    // a witness on the current wallet route before looking in any code cache.
    const witness = await rpc({ ...body, method: 'eth_getProof', params: [address, [], body.params.at(-1)] });
    hash = await verifyAccountResponse(address, [], block, witness.result);
    hashes.set(address.toLowerCase(), hash);
  }
  return cache.load(hash, async () => (await rpc(body)).result);
}
