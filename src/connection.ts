import { AnonRpcWorker } from '@anon-rpc/browser-harness';
import { createPublicClient, decodeAbiParameters, http, toFunctionSelector, type Hex } from 'viem';
import { mainnet } from 'viem/chains';
import { config, TOR_SPECIFIER, assertTorWorkerHash } from './config';

export type ConnectionState = 'starting' | 'ready' | 'failed';
export class Connection {
  private worker?: AnonRpcWorker;
  private pending?: Promise<AnonRpcWorker>;
  constructor(
    private onState: (state: ConnectionState) => void,
    private onProgress: (message: string) => void = () => {},
  ) {}
  get(): Promise<AnonRpcWorker> {
    if (this.pending) return this.pending;
    this.onState('starting');
    this.onProgress('Discovering the tor-js worker through ' + new URL(config.bootstrapRpc).hostname + '. This public lookup contains only the worker contract address.');
    // This public client is ONLY handed to the specifier resolver, never a balance reader.
    const bootstrap = createPublicClient({ chain: mainnet,
      transport: http(config.bootstrapRpc, { batch: false, timeout: 20_000, retryCount: 1 }) });
    let pendingLookups = 0;
    let discoveryFailed = false;
    let resolverSummary = '';
    const worker = this.worker = new AnonRpcWorker({
      address: TOR_SPECIFIER, config: { gateways: config.gateways },
      preExisting: { rpcProvider: { request: async ({ method, params }) => {
        pendingLookups++;
        this.onProgress('Requesting ' + method + ' for worker contract ' + TOR_SPECIFIER
          + ' from ' + new URL(config.bootstrapRpc).hostname + ' (public discovery; no watched wallet sent).');
        try {
          const result = await bootstrap.request({ method, params } as Parameters<typeof bootstrap.request>[0]);
          const call = Array.isArray(params) ? params[0] as { data?: string } | undefined : undefined;
          if (call?.data === toFunctionSelector('workerHash()')) assertTorWorkerHash(result);
          if (call?.data === toFunctionSelector('workerResolvers()') && typeof result === 'string') {
            try {
              const [resolvers] = decodeAbiParameters([{ type: 'string[]' }], result as Hex);
              resolverSummary = ' Advertised bundle resolver(s): ' + resolvers.map(url => {
                try { return new URL(url).host || new URL(url).protocol; } catch { return 'unrecognized resolver'; }
              }).join(', ') + '.';
            } catch { /* the harness validates and decodes the actual specifier */ }
          }
          return result;
        } catch (error) {
          discoveryFailed = true;
          throw error;
        } finally {
          if (--pendingLookups === 0 && !discoveryFailed) this.onProgress('Worker contract lookup finished.' + resolverSummary + ' The harness is loading and hash-verifying the bundle, then starting its sandbox. Waiting for worker readiness.');
        }
      } } },
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
