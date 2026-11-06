import { setHeliosStatus } from './status';
import { RequestPurposes } from './request-purpose';
import { operatorRoute, executionWithOperators, type OperatorRoute } from './operators';
import type { NetworkProgress, VerificationStage } from './progress';
import { config } from '../config';
import { DEFAULT_CHECKPOINT } from './trust';
import type { PrivateWorker, Wallet } from '../balances';
import { loadPricing, type Estimate, type PricingSettings } from '../pricing';
import type { Token } from '../tokens';
import type { VerifiedBlock } from './trust';
import { privateConsensusGet, transportRoute } from './transport';
export type VerifiedAmount = { asset: string; amount: string; decimals: number; block: VerifiedBlock; estimate?: Estimate };
export type VerificationEvent = { type: string; message?: string; asset?: string; error?: string; stage?: VerificationStage; request?: NetworkProgress } & Partial<VerifiedAmount>;
let shared: Worker | undefined;
let verifierAbort: AbortController | undefined;
let consensusRoute: { worker: PrivateWorker; key: string } | undefined;
type Session = { wallet: Wallet; privateWorker: PrivateWorker; event: (event: VerificationEvent) => void; resolve: () => void; reject: (error: Error) => void;
  purposes:RequestPurposes; route:OperatorRoute; remaining: Set<string>; succeeded: number; stage?: VerificationStage; pricingAssets: Set<string>; controller: AbortController; timer?: ReturnType<typeof setTimeout>; cleanup?: () => void; request: object };
const sessions = new Map<string, Session>();
let active: string | undefined;
function resetWorker(error: Error, cancelled = false) {
  setHeliosStatus(cancelled ? { phase: 'idle' } : { phase: 'unavailable', error: error.message });
  shared?.terminate(); shared = undefined;
  verifierAbort?.abort(error); verifierAbort = undefined;
}
function finish(id: string, error?: Error, reset = false, cancelled = false) {
  const session = sessions.get(id);
  if (!session) return;
  clearTimeout(session.timer); sessions.delete(id); session.cleanup?.();
  if (error) for (const asset of session.pricingAssets) session.event({ type: 'price-error', asset, error: error.message });
  session.controller.abort(error || new Error('Verification finished.'));
  if (active === id) active = undefined;
  if (reset) resetWorker(error || new Error('Verifier reset.'), cancelled);
  if (error) session.reject(error); else session.resolve();
  // Let this wallet leave its loading state before starting another one.
  queueMicrotask(pump);
}
function pump() {
  if (active || !sessions.size) return;
  const [id, session] = sessions.entries().next().value!;
  active = id;
  try {
    if (consensusRoute?.worker !== session.privateWorker) {
      if (consensusRoute) resetWorker(new Error('Verification transport changed.'));
      consensusRoute = { worker: session.privateWorker, key: 'consensus-' + crypto.randomUUID() };
    }
    const worker = getWorker();
    session.stage = 'verifier';
    session.event({ type: 'started', message: 'Starting finalized balance verification.' });
    // Queued wallets have no spinner or session timer until their work starts.
    session.timer = setTimeout(() => finish(id, new Error('Verification timed out after five minutes; cached values remain stale.'), true), 300_000);
    worker.postMessage(session.request);
  } catch (error) { finish(id, error instanceof Error ? error : new Error(String(error)), true); }
}
function networkReporter(session: Session, info: Pick<NetworkProgress, 'requestId' | 'method' | 'host' | 'asset' | 'purpose' | 'target'>) {
  const startedAt = Date.now();
  return (state: NetworkProgress['state']) => {
    if (![...sessions.values()].includes(session)) return;
    session.event({ type: 'network', request: { ...info, state, startedAt, deadline: startedAt + 90_000 } });
  };
}
function getWorker() {
  if (shared) return shared;
  setHeliosStatus({ phase: 'starting' });
  const worker = shared = new Worker(new URL('./helios.worker.ts', import.meta.url), { type: 'module' });
  const lifetime = verifierAbort = new AbortController();
  worker.onerror = event => {
    if (shared !== worker) return;
    const error = new Error('Helios verification worker failed: ' + event.message + '. No unverified fallback.');
    if (active) finish(active, error, true); else resetWorker(error);
  };
  worker.onmessageerror = () => {
    if (shared !== worker) return;
    const error = new Error('Helios worker response could not be decoded.');
    if (active) finish(active, error, true); else resetWorker(error);
  };
  worker.onmessage = async event => {
    if (shared !== worker) return;
    const message = event.data;
    if (message.type === 'helios-status') {
      setHeliosStatus(message.status);
      return;
    }
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
      let report: ReturnType<typeof networkReporter>;
      try {
        const data = await executionWithOperators(session.privateWorker,session.route,session.wallet.isolationKey,message.body,session.controller.signal,
          (url,state)=>{
            if(state==='waiting') report=networkReporter(session,{requestId:message.id,method:message.body.method,host:new URL(url).hostname,asset:message.asset,...session.purposes.describe(message.body),...(message.purpose ? {purpose:message.purpose} : {})});
            report(state);
          },(from,to)=>{
            session.wallet.rpcUrl=to;
            session.event({type:'progress',message:new URL(from).hostname+' cannot serve proofs at the selected finalized block. Retrying the identical request through ' + transportRoute(session.privateWorker) + ' at '+new URL(to).hostname+' with the same address isolation key.'});
            worker.postMessage({type:'rpc-operator',run:message.run,host:new URL(to).host});
          });
        if (shared === worker && active === message.run && sessions.has(message.run)) worker.postMessage({ type: 'reply', id: message.id, data });
      } catch (error) {
        if (shared === worker && active === message.run && sessions.has(message.run)) finish(message.run, error instanceof Error ? error : new Error(String(error)), true);
      }
    } else if (message.type === 'done' || message.type === 'fatal') {
      finish(message.run, message.type === 'fatal' ? new Error(message.error) : undefined, message.type === 'fatal');
    } else {
      if (message.stage) session.stage = message.stage;
      if (!message.stage && message.type === 'asset') session.stage = 'balances';
      if (!message.stage && message.type === 'price-start') session.stage = 'pricing';
      if (message.type === 'price-start') session.pricingAssets.add(message.asset);
      else if (message.type === 'price' || message.type === 'price-error') session.pricingAssets.delete(message.asset);
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
export async function verifyWallet(wallet: Wallet, privateWorker: PrivateWorker, tokens: Token[], event: (event: VerificationEvent) => void, pricing: PricingSettings = loadPricing(), signal?: AbortSignal) {
  signal?.throwIfAborted();
  const id = crypto.randomUUID();
  event({ type: 'queued', message: 'Queued for the shared Helios verifier; waiting for the active address to finish.' });
  return new Promise<void>((resolve, reject) => {
    sessions.set(id, { wallet, privateWorker, purposes:new RequestPurposes(wallet.address,tokens,pricing), event, resolve, reject, route:operatorRoute(wallet.rpcUrl,[...config.rpcUrls]), remaining: new Set(tokens.map(token => token.address)), succeeded: 0, pricingAssets: new Set(), controller: new AbortController(),
      request: { type: 'refresh', id, address: wallet.address, rpcHost: new URL(wallet.rpcUrl).host, mode: privateWorker.transport || 'tor', checkpoint: config.checkpoint || DEFAULT_CHECKPOINT, tokens, pricing } });
    const aborted = () => finish(id, new Error('Address verification cancelled.'), active === id, true);
    sessions.get(id)!.cleanup = () => signal?.removeEventListener('abort', aborted);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted(); else pump();
  });
}
