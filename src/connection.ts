import { errorMessage } from './errors';
import { AnonRpcWorker } from '@anon-rpc/browser-harness';
import bundleUrl from '../vendor/tor/anon-rpc-worker.js?url&no-inline';
import { pinnedSpecifierProvider } from './bootstrap';
import { config, TOR_SPECIFIER } from './config';

export type ConnectionState = 'starting' | 'ready' | 'failed';
export class Connection {
  lastError?: string;
  private worker?: AnonRpcWorker;
  private pending?: Promise<AnonRpcWorker>;
  constructor(
    private onState: (state: ConnectionState) => void,
    private onProgress: (message: string) => void = () => {},
  ) {}
  get(): Promise<AnonRpcWorker> {
    if (this.pending) return this.pending;
    this.lastError = undefined;
    this.onState('starting');
    this.onProgress('Loading the bundled Tor worker and verifying its pinned hash locally. No Ethereum RPC is contacted during startup.');
    const localBundle = new URL(bundleUrl, document.baseURI);
    if (localBundle.origin !== window.location.origin) throw new Error('Tor worker bundle must be served with the application.');
    const worker = this.worker = new AnonRpcWorker({
      address: TOR_SPECIFIER, config: { gateways: config.gateways },
      preExisting: { rpcProvider: pinnedSpecifierProvider(localBundle.href) },
    });
    // Drain logs without sending them to console or an analytics service.
    void (async () => {
      try { for (;;) await worker.acceptLog(); }
      catch (error) {
        if (this.worker === worker) {
          this.lastError ||= 'Private worker stopped: ' + errorMessage(error);
          this.worker = undefined;
          this.pending = undefined;
          this.onState('failed');
        }
      }
    })();
    this.pending = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([worker.ready, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Private connection timed out')), 120_000);
        })]);
        this.lastError = undefined;
        this.onState('ready');
        return worker;
      } catch (error) {
        this.lastError ||= errorMessage(error);
        worker.close();
        if (this.worker === worker) {
          this.worker = undefined;
          this.pending = undefined;
          this.onState('failed');
        }
        throw new Error('Private connection unavailable: ' + this.lastError);
      } finally { clearTimeout(timer); }
    })();
    return this.pending;
  }
  close() {
    const worker = this.worker;
    this.worker = undefined;
    this.pending = undefined;
    worker?.close();
  }
}
