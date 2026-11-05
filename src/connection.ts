import { errorMessage } from './errors';
import { AnonRpcWorker } from '@anon-rpc/browser-harness';
import bundleUrl from '../vendor/tor/anon-rpc-worker.js?url&no-inline';
import { pinnedSpecifierProvider } from './bootstrap';
import { cachedTorWorkerUrl } from './worker-update';
import { config, TOR_SPECIFIER, TOR_WORKER_HASH } from './config';

export type ConnectionState = 'starting' | 'ready' | 'failed';
export class Connection {
  lastError?: string;
  private warnings: string[] = [];
  private worker?: AnonRpcWorker;
  private pending?: Promise<AnonRpcWorker>;
  constructor(
    private onState: (state: ConnectionState) => void,
    private onProgress: (message: string) => void = () => {},
  ) {}
  get(): Promise<AnonRpcWorker> {
    if (this.pending) return this.pending;
    this.lastError = undefined;
    this.warnings = [];
    this.onState('starting');
    // Defer start so synchronous initialization failures also clear pending.
    this.pending = Promise.resolve().then(() => this.start());
    return this.pending;
  }
  private async start(): Promise<AnonRpcWorker> {
    let worker: AnonRpcWorker | undefined;
    let objectUrl: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      this.onProgress(config.torWorker ? 'Loading your saved Tor worker and verifying its selected hash locally. No public discovery request is sent.' : 'Loading the bundled Tor worker and verifying its pinned hash locally. No Ethereum RPC is contacted during startup.');
      const localBundle = new URL(bundleUrl, document.baseURI);
      if (localBundle.origin !== window.location.origin) throw new Error('Tor worker bundle must be served with the application.');
      if (config.torWorker) objectUrl = await cachedTorWorkerUrl(config.torWorker);
      worker = this.worker = new AnonRpcWorker({
        address: TOR_SPECIFIER, config: { gateways: config.gateways },
        preExisting: { rpcProvider: pinnedSpecifierProvider(objectUrl || localBundle.href, config.torWorker?.hash || TOR_WORKER_HASH) },
      });
      this.drainLogs(worker);
      await Promise.race([worker.ready, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Private connection timed out')), 120_000);
      })]);
      this.lastError = undefined;
      this.onState('ready');
      return worker;
    } catch (error) {
      this.lastError ||= this.failureMessage(error);
      worker?.close();
      this.worker = undefined;
      this.pending = undefined;
      this.onState('failed');
      throw new Error('Private connection unavailable: ' + this.lastError);
    } finally {
      clearTimeout(timer);
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
          if (entry.level !== 'warn' && entry.level !== 'error') continue;
          const message = errorMessage(entry.args.map(arg => errorMessage(arg)).join(' ')).slice(0, 350);
          this.warnings.push(message);
          this.warnings = this.warnings.slice(-2);
          if (!this.lastError) this.onProgress('Tor worker: ' + message);
        }
      }
      catch (error) {
        if (this.worker === worker) {
          this.lastError ||= this.failureMessage(error);
          this.worker = undefined;
          this.pending = undefined;
          this.onState('failed');
        }
      }
    })();
  }
  private failureMessage(error: unknown) {
    const reason = errorMessage(error);
    const diagnostics = this.warnings.length ? ' Recent Tor diagnostics: ' + this.warnings.join(' · ') : ' The Tor worker supplied no additional diagnostics.';
    return reason + diagnostics;
  }
  close() {
    const worker = this.worker;
    this.worker = undefined;
    this.pending = undefined;
    worker?.close();
  }
}
