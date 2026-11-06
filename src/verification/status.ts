import type { VerifiedBlock } from './trust';

export type HeliosPhase = 'idle' | 'starting' | 'syncing' | 'ready' | 'unavailable';
export type HeliosStatus = { phase: HeliosPhase; block?: VerifiedBlock; error?: string };
let status: HeliosStatus = { phase: 'idle' };
const listeners = new Set<(status: HeliosStatus) => void>();
export function heliosStatus() { return status; }
export function setHeliosStatus(next: HeliosStatus) {
  status = next;
  for (const listener of listeners) listener(status);
}
export function subscribeHeliosStatus(listener: (status: HeliosStatus) => void) {
  listeners.add(listener);
  listener(status);
  return () => { listeners.delete(listener); };
}
