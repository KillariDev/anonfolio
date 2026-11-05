import type { NetworkProgress, VerificationStage } from './progress';
import { config } from '../config';
import { DEFAULT_CHECKPOINT } from './trust';
import type { PrivateWorker, Wallet } from '../balances';
import { loadPricing, type Estimate, type PricingSettings } from '../pricing';
import type { Token } from '../tokens';
import type { VerifiedBlock } from './trust';
import { privateExecutionRpc, privateConsensusGet } from './transport';
export type VerifiedAmount = { asset: string; amount: string; decimals: number; block: VerifiedBlock; estimate?: Estimate };
export type VerificationEvent = { type: string; message?: string; asset?: string; error?: string; stage?: VerificationStage; request?: NetworkProgress } & Partial<VerifiedAmount>;
let shared: Worker | undefined;
let verifierAbort: AbortController | undefined;
let consensusRoute: { worker: PrivateWorker; key: string } | undefined;
type Session = { wallet: Wallet; privateWorker: PrivateWorker; event: (event: VerificationEvent) => void; resolve: () => void; reject: (error: Error) => void;
  remaining: Set<string>; succeeded: number; stage?: VerificationStage; pricingAsset?: string; controller: AbortController; timer?: ReturnType<typeof setTimeout>; request: object };
const sessions = new Map<string, Session>();
let active: string | undefined;
function resetWorker(error: Error) {
  shared?.terminate(); shared = undefined;
  verifierAbort?.abort(error); verifierAbort = undefined;
}
function finish(id: string, error?: Error, reset = false) {
  const session = sessions.get(id);
  if (!session) return;
  clearTimeout(session.timer); sessions.delete(id);
  if (error && session.pricingAsset) session.event({ type: 'price-error', asset: session.pricingAsset, error: error.message });
  session.controller.abort(error || new Error('Verification finished.'));
  if (active === id) active = undefined;
  if (reset) resetWorker(error || new Error('Verifier reset.'));
  if (error) session.reject(error); else session.resolve();
  // Let this wallet leave its loading state before starting another one.
  queueMicrotask(pump);
}
function pump() {
  if (active || !sessions.size) return;
  const [id, session] = sessions.entries().next().value!;
  active = id;
  try {
    if (consensusRoute?.worker !== session.privateWorker) consensusRoute = { worker: session.privateWorker, key: 'consensus-' + crypto.randomUUID() };
    const worker = getWorker();
    session.stage = 'verifier';
    session.event({ type: 'started', message: 'Starting finalized balance verification.' });
    // Queued wallets have no spinner or session timer until their work starts.
    session.timer = setTimeout(() => finish(id, new Error('Verification timed out after five minutes; cached values remain stale.'), true), 300_000);
    worker.postMessage(session.request);
  } catch (error) { finish(id, error instanceof Error ? error : new Error(String(error)), true); }
}
function networkReporter(session: Session, info: Pick<NetworkProgress, 'requestId' | 'method' | 'host' | 'asset'>) {
  const startedAt = Date.now();
  return (state: NetworkProgress['state']) => {
    if (![...sessions.values()].includes(session)) return;
    session.event({ type: 'network', request: { ...info, state, startedAt, deadline: startedAt + 90_000 } });
  };
}
function getWorker() {
  if (shared) return shared;
  const worker = shared = new Worker(new URL('./helios.worker.ts', import.meta.url), { type: 'module' });
  const lifetime = verifierAbort = new AbortController();
  worker.onerror = event => {
    if (shared !== worker) return;
    const error = new Error('Helios verification worker failed: ' + event.message + '. No unverified fallback.');
    if (active) finish(active, error, true); else resetWorker(error);
  };
  worker.onmessageerror = () => {
    if (shared === worker && active) finish(active, new Error('Helios worker response could not be decoded.'), true);
  };
  worker.onmessage = async event => {
    if (shared !== worker) return;
    const message = event.data;
    if (message.type === 'consensus') {
      try {
        const session = active ? sessions.get(active) : undefined;
        const report = session?.stage === 'consensus' ? networkReporter(session, { requestId: message.id, method: 'GET ' + new URL(message.url).pathname.split('/').slice(1, 6).join('/'), host: new URL(message.url).hostname }) : undefined;
        report?.('waiting');
        if (!consensusRoute) throw new Error('Private consensus route unavailable; no direct fallback.');
        const data = await privateConsensusGet(consensusRoute.worker, consensusRoute.key, message.url, lifetime.signal, report);
        if (shared === worker) worker.postMessage({ type: 'consensus-reply', id: message.id, data });
      } catch (error) {
        if (shared === worker) {
          const failure = error instanceof Error ? error : new Error(String(error));
          if (active) finish(active, failure, true); else resetWorker(failure);
        }
      }
      return;
    }
    const session = sessions.get(message.run);
    if (!session || active !== message.run) return;
    if (message.type === 'rpc') {
      const report = networkReporter(session, { requestId: message.id, method: message.body.method, host: new URL(session.wallet.rpcUrl).hostname, asset: message.asset });
      report('waiting');
      try {
        const data = await privateExecutionRpc(session.privateWorker, session.wallet, message.body, session.controller.signal, report);
        if (shared === worker && active === message.run && sessions.has(message.run)) worker.postMessage({ type: 'reply', id: message.id, data });
      } catch (error) {
        if (shared === worker && active === message.run && sessions.has(message.run)) finish(message.run, error instanceof Error ? error : new Error(String(error)), true);
      }
    } else if (message.type === 'done' || message.type === 'fatal') {
      finish(message.run, message.type === 'fatal' ? new Error(message.error) : undefined, message.type === 'fatal');
    } else {
      if (message.stage) session.stage = message.stage;
      if (message.type === 'asset') session.stage = 'balances';
      if (message.type === 'price-start') session.stage = 'pricing';
      if (message.type === 'price-start') session.pricingAsset = message.asset;
      else if (message.type === 'price' || message.type === 'price-error') session.pricingAsset = undefined;
      session.event(message);
      if (message.type === 'balance' || message.type === 'asset-error') {
        session.remaining.delete(message.asset);
        if (message.type === 'balance') session.succeeded++;
        if (!session.remaining.size && !session.succeeded) finish(message.run, new Error('All balance reads failed; waiting to retry.'), true);
      }
    }
  };
  return worker;
}
export async function verifyWallet(wallet: Wallet, privateWorker: PrivateWorker, tokens: Token[], event: (event: VerificationEvent) => void, pricing: PricingSettings = loadPricing()) {
  const id = crypto.randomUUID();
  event({ type: 'queued', message: 'Queued for the shared Helios verifier; waiting for the active address to finish.' });
  return new Promise<void>((resolve, reject) => {
    sessions.set(id, { wallet, privateWorker, event, resolve, reject, remaining: new Set(tokens.map(token => token.address)), succeeded: 0, controller: new AbortController(),
      request: { type: 'refresh', id, address: wallet.address, rpcHost: new URL(wallet.rpcUrl).host, checkpoint: config.checkpoint || DEFAULT_CHECKPOINT, tokens, pricing } });
    pump();
  });
}
