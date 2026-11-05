// Reviewed Helios 0.12.0 (2af9b418), including PR #813 and missing-slot checks.
export const HELIOS_WASM_SHA256 = 'edbf06fa1cc95e2e406bdbdab780948f5b47a4cf7d9c82d32fd415f78f1448e8';
export const CONSENSUS_RPC = 'https://ethereum-beacon-api.publicnode.com';
// Independently compared with beaconcha.in, Attestant, and ChainSafe checkpointz.
export const CHECKPOINT = '0xe69fdb2e234b0627296c707c2c6ee401c237d4f22abefef4d2ed3c06de994388';
export const CHECKPOINT_TIME = 1793892311000;
export type Checkpoint = { root: string; slot: number };
export const DEFAULT_CHECKPOINT: Checkpoint = { root: CHECKPOINT, slot: 15589024 };
// Mainnet genesis, derived from the independently reviewed checkpoint's slot/time.
const MAINNET_GENESIS_TIME = CHECKPOINT_TIME - DEFAULT_CHECKPOINT.slot * 12_000;
export function validateCheckpoint(value: unknown): Checkpoint {
  const data = value as Partial<Checkpoint> | null;
  if (!data || typeof data.root !== 'string' || !/^0x[0-9a-f]{64}$/i.test(data.root.trim()) || /^0x0{64}$/i.test(data.root.trim())) {
    throw new Error('Checkpoint root must be a nonzero 32-byte beacon block root (0x followed by 64 hexadecimal characters).');
  }
  if (typeof data.slot !== 'number' || !Number.isSafeInteger(data.slot) || data.slot < 1 || data.slot > Math.floor((Number.MAX_SAFE_INTEGER - MAINNET_GENESIS_TIME) / 12_000)) {
    throw new Error('Checkpoint slot must be a positive whole mainnet beacon slot number.');
  }
  return { root: data.root.trim().toLowerCase(), slot: data.slot };
}
export function checkCheckpointAge(now = Date.now(), checkpoint: Checkpoint = DEFAULT_CHECKPOINT) {
  const { slot } = validateCheckpoint(checkpoint);
  const timestamp = MAINNET_GENESIS_TIME + slot * 12_000;
  if (now < timestamp - 60_000 || now - timestamp > 14 * 86400_000) {
    throw new Error('Consensus checkpoint is outside its 14-day trust window or in the future. Choose a recent independently verified mainnet checkpoint in Settings → Consensus checkpoint, or install an updated application release.');
  }
}
// Helios subsequently binds this bootstrap header to the trusted root. Binding
// its slot here prevents an old checkpoint being relabelled as recent in Settings.
export function assertCheckpointSlot(bootstrap: any, checkpoint: Checkpoint) {
  if (String(bootstrap?.data?.header?.beacon?.slot) !== String(checkpoint.slot)) {
    throw new Error('Consensus checkpoint slot does not match its bootstrap header. Check the root and slot together in Settings → Consensus checkpoint.');
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
