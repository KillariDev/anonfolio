import type { VerifiedBlock } from './verification/trust';

type Provenance = { verifiedBlock?: VerifiedBlock; updatedAt?: number };

// A slower tab/request must not move a holding backwards in finalized history.
// Read time only breaks ties at the same height; it cannot outweigh block height.
export function olderBalance(candidate: Provenance | undefined, current: Provenance | undefined): boolean {
  if (!current?.verifiedBlock) return false;
  if (!candidate?.verifiedBlock) return true;
  const next = BigInt(candidate.verifiedBlock.number), previous = BigInt(current.verifiedBlock.number);
  return next < previous || (next === previous && (candidate.updatedAt || 0) < (current.updatedAt || 0));
}
