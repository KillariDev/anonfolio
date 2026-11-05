import { AnonRpcWorker } from '@anon-rpc/browser-harness';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { config, TOR_SPECIFIER } from './config';

export type ConnectionState = 'starting' | 'ready' | 'failed';
export class Connection {
  private worker?: AnonRpcWorker;
  private pending?: Promise<AnonRpcWorker>;
  constructor(private onState: (state: ConnectionState) => void) {}
  get(): Promise<AnonRpcWorker> {
    if (this.pending) return this.pending;
    this.onState('starting');
    // This public client is ONLY handed to the specifier resolver, never a balance reader.
    const bootstrap = createPublicClient({ chain: mainnet,
      transport: http(config.bootstrapRpc, { batch: false, timeout: 20_000, retryCount: 1 }) });
    const worker = this.worker = new AnonRpcWorker({
      address: TOR_SPECIFIER, config: { gateways: config.gateways },
      preExisting: { rpcProvider: { request: ({ method, params }) =>
        bootstrap.request({ method, params } as Parameters<typeof bootstrap.request>[0]) } },
    });
    // Drain logs without sending them to console or an analytics service.
    void (async () => {
      try { for (;;) await worker.acceptLog(); }
      catch {
        if (this.worker === worker) {
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
        this.onState('ready');
        return worker;
      } catch {
        worker.close();
        if (this.worker === worker) {
          this.worker = undefined;
          this.pending = undefined;
          this.onState('failed');
        }
        throw new Error('Private connection unavailable');
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
