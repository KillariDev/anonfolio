// Reviewed Helios 0.12.0 (2af9b418), including PR #813 and missing-slot checks.
export const HELIOS_WASM_SHA256 = 'edbf06fa1cc95e2e406bdbdab780948f5b47a4cf7d9c82d32fd415f78f1448e8';
export const CONSENSUS_RPC = 'https://ethereum-beacon-api.publicnode.com';
// Independently compared with beaconcha.in, Attestant, and ChainSafe checkpointz.
export const CHECKPOINT = '0xe69fdb2e234b0627296c707c2c6ee401c237d4f22abefef4d2ed3c06de994388';
export const CHECKPOINT_TIME = 1793892311000;
export function checkCheckpointAge(now = Date.now()) {
  if (now < CHECKPOINT_TIME - 60_000 || now - CHECKPOINT_TIME > 14 * 86400_000) {
    throw new Error('Pinned consensus checkpoint is outside its 14-day trust window. A reviewed checkpoint update is required.');
  }
}
export type VerifiedBlock = { hash: string; number: string; stateRoot: string; timestamp: number };
export function verifiedBlock(value: any): VerifiedBlock {
  const data = value instanceof Map ? Object.fromEntries(value) : value;
  if (!data || !/^0x[0-9a-f]{64}$/i.test(data.hash) || !/^0x[0-9a-f]{64}$/i.test(data.stateRoot)) throw new Error('No verified finalized execution block.');
  const timestamp = Number(BigInt(data.timestamp)) * 1000;
  if (!Number.isSafeInteger(timestamp) || timestamp > Date.now() + 60_000 || Date.now() - timestamp > 3600_000) throw new Error('Verified finalized block is too old or in the future.');
  return { hash: data.hash, stateRoot: data.stateRoot, number: '0x' + BigInt(data.number).toString(16), timestamp };
}
