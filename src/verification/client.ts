import type { PrivateWorker, Wallet } from '../balances';
import type { Token } from '../tokens';
import type { VerifiedBlock } from './trust';
import { privateExecutionRpc } from './transport';
export type VerifiedAmount = { asset: string; amount: string; decimals: number; decimalsVerified: boolean; block: VerifiedBlock };
export type VerificationEvent = { type: string; message?: string; asset?: string; error?: string } & Partial<VerifiedAmount>;
let shared: Worker | undefined;
type Session = { wallet: Wallet; privateWorker: PrivateWorker; event: (event: VerificationEvent) => void; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const sessions = new Map<string, Session>();
function close(error: Error) {
  shared?.terminate(); shared = undefined;
  for (const session of sessions.values()) { clearTimeout(session.timer); session.reject(error); }
  sessions.clear();
}
function getWorker() {
  if (shared) return shared;
  shared = new Worker(new URL('./helios.worker.ts', import.meta.url), { type: 'module' });
  shared.onerror = event => close(new Error('Helios verification worker failed: ' + event.message + '. No unverified fallback.'));
  shared.onmessage = async event => {
    const message = event.data;
    const session = sessions.get(message.run);
    if (!session) return;
    if (message.type === 'rpc') {
      const target = shared;
      try {
        const data = await privateExecutionRpc(session.privateWorker, session.wallet, message.body);
        if (shared === target && sessions.has(message.run)) target!.postMessage({ type: 'reply', id: message.id, data });
      } catch (error) { if (shared === target) target!.postMessage({ type: 'reply', id: message.id, error: String(error) }); }
    } else if (message.type === 'done' || message.type === 'fatal') {
      clearTimeout(session.timer); sessions.delete(message.run);
      if (message.type === 'fatal') { session.reject(new Error(message.error)); close(new Error(message.error)); }
      else session.resolve();
    } else session.event(message);
  };
  return shared;
}
export async function verifyWallet(wallet: Wallet, privateWorker: PrivateWorker, tokens: Token[], event: (event: VerificationEvent) => void) {
  const id = crypto.randomUUID();
  event({ type: 'progress', message: 'Queued for the shared Helios verifier; each wallet keeps its own Anon-RPC route.' });
  const worker = getWorker();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => close(new Error('Verification timed out; cached values remain stale.')), 300_000);
    sessions.set(id, { wallet, privateWorker, event, resolve, reject, timer });
    worker.postMessage({ type: 'refresh', id, address: wallet.address, rpcHost: new URL(wallet.rpcUrl).host, tokens });
  });
}
