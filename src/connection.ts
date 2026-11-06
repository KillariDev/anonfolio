import { httpsTransport } from './https-transport';
import type { PrivateWorker } from './balances';
import { loadTorBootstrap, torStartupStage } from './tor-bootstrap';
import { withDeadline } from './deadline';
import { errorMessage } from './errors';
import { AnonRpcWorker } from '@anon-rpc/browser-harness';
import bundleUrl from '../vendor/tor/anon-rpc-worker.js?url&no-inline';
import { pinnedSpecifierProvider } from './bootstrap';
import { cachedTorWorkerUrl } from './worker-update';
import { config, TOR_SPECIFIER, TOR_WORKER_HASH } from './config';

export const PRIVATE_STARTUP_TIMEOUT_MS = 300_000;
export const PRIVATE_STARTUP_NOTICE_MS = 30_000;

export type ConnectionState = 'starting' | 'ready' | 'failed';
export class Connection {
  lastError?: string;
  phase?: string;
  slow = false;
  cancelled = false;
  private warnings: string[] = [];
  private worker?: PrivateWorker & { close(): void };
  private pending?: Promise<PrivateWorker>;
  private startup?: AbortController;
  constructor(
    private onState: (state: ConnectionState) => void,
    private onProgress: (message: string) => void = () => {},
  ) {}
  get(): Promise<PrivateWorker> {
    if (this.pending) return this.pending;
    this.lastError = undefined;
    this.phase = undefined; this.slow = false; this.cancelled = false;
    this.warnings = [];
    if (config.mode === 'https') {
      const worker = this.worker = httpsTransport(config.rpcUrls);
      this.pending = Promise.resolve(worker);
      this.onState('ready');
      return this.pending;
    }
    const startup = this.startup = new AbortController();
    this.onState('starting');
    // Defer start so synchronous initialization failures also clear pending.
    this.pending = Promise.resolve().then(() => this.start(startup));
    return this.pending;
  }
  private async start(startup: AbortController): Promise<PrivateWorker> {
    let worker: AnonRpcWorker | undefined;
    let objectUrl: string | undefined;
    const notice = setTimeout(() => {
      if (this.startup !== startup || startup.signal.aborted) return;
      this.slow = true;
      this.onProgress('Tor connection is taking longer than usual; keeping the current bootstrap attempt alive (five-minute limit).');
    }, PRIVATE_STARTUP_NOTICE_MS);
    try {
      startup.signal.throwIfAborted();
      this.onProgress(config.torWorker ? 'Loading your saved Tor worker and verifying its selected hash locally. No public discovery request is sent.' : 'Loading the bundled Tor worker and verifying its pinned hash locally. No Ethereum RPC is contacted during startup.');
      const localBundle = new URL(bundleUrl, document.baseURI);
      if (localBundle.origin !== window.location.origin) throw new Error('Tor worker bundle must be served with the application.');
      if (config.torWorker) objectUrl = await cachedTorWorkerUrl(config.torWorker);
      startup.signal.throwIfAborted();
      const bootstrap = await loadTorBootstrap(config.bootstrapUrl ?? './tor-bootstrap.json', startup.signal, this.onProgress);
      startup.signal.throwIfAborted();
      this.phase = 'Connecting to Tor gateways…';
      this.onProgress('Starting Tor with ' + config.gateways.length + ' configured gateway(s).');
      worker = this.worker = new AnonRpcWorker({
        address: TOR_SPECIFIER, config: { gateways: config.gateways, logLevel: 'info', ...(bootstrap ? { bootstrap } : {}) },
        preExisting: { rpcProvider: pinnedSpecifierProvider(objectUrl || localBundle.href, config.torWorker?.hash || TOR_WORKER_HASH) },
      });
      this.drainLogs(worker);
      await withDeadline(() => worker!.ready, PRIVATE_STARTUP_TIMEOUT_MS, 'Private connection timed out after five minutes', startup.signal);
      startup.signal.throwIfAborted();
      this.lastError = undefined;
      this.onState('ready');
      return worker;
    } catch (error) {
      worker?.close();
      if (this.startup !== startup) throw error;
      this.lastError ||= this.failureMessage(error);
      this.worker = undefined;
      this.pending = undefined;
      this.onState('failed');
      throw new Error('Private connection unavailable: ' + this.lastError);
    } finally {
      clearTimeout(notice);
      if (this.startup === startup) this.startup = undefined;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }
  private drainLogs(worker: AnonRpcWorker) {
    // Keep only bounded, redacted warning/error diagnostics locally; never log request payloads.
    void (async () => {
      try {
        for (;;) {
          const entry = await worker.acceptLog();
          if (this.worker !== worker) return;
          const message = errorMessage(entry.args.map(arg => errorMessage(arg)).join(' ')).slice(0, 350);
          const phase = torStartupStage(message);
          if (this.startup && phase && this.phase !== phase) { this.phase = phase; this.onProgress(phase); }
          if (entry.level !== 'warn' && entry.level !== 'error') continue;
          this.warnings.push(message);
          this.warnings = this.warnings.slice(-2);
          if (!this.lastError) this.onProgress('Tor worker: ' + message);
        }
      }
      catch (error) {
        if (this.worker === worker) {
          this.lastError ||= this.failureMessage(error);
          if (this.startup) { this.startup.abort(error); return; }
          this.worker = undefined;
          this.pending = undefined;
          worker.close();
          this.onState('failed');
        }
      }
    })();
  }
  private failureMessage(error: unknown) {
    const reason = errorMessage(error);
    const diagnostics = this.warnings.length ? '\nRecent Tor diagnostics:\n' + this.warnings.join('\n') : '\nThe Tor worker supplied no additional diagnostics.';
    return reason + diagnostics;
  }
  cancel() {
    this.cancelled = true;
    this.close();
    this.lastError = 'Connection cancelled. Retry when you are ready.';
    this.onState('failed');
  }
  close() {
    const startup = this.startup;
    this.startup = undefined;
    startup?.abort(new Error('Private connection closed.'));
    const worker = this.worker;
    this.worker = undefined;
    this.pending = undefined;
    worker?.close();
  }
}
