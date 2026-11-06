import type { Hex } from 'viem';
import { readResponseText } from '../response-body';
import bundled from './bytecode/mainnet.json';
import { verifyCode } from './proofs';

const MAX_ENTRIES = 128;
const MAX_CODE_BYTES = 64 * 1024;
export interface CodeStore {
  get(hash: Hex): Promise<string | undefined>;
  put(hash: Hex, code: Hex): Promise<void>;
}
// Cache Storage works in the verifier worker, and persists across reloads. These
// are local content-addressed entries: cache.match/put never perform a fetch.
export function browserCodeStore(): CodeStore {
  const open = () => caches.open('anonfolio-verified-bytecode-v1');
  const key = (hash: Hex) => new URL('./__verified_bytecode__/' + hash, self.location.href).href;
  let writes = Promise.resolve();
  return {
    async get(hash) {
      const saved = await (await open()).match(key(hash));
      return saved ? readResponseText(saved, 2 + 2 * MAX_CODE_BYTES, 'Cached bytecode') : undefined;
    },
    put(hash, code) {
      const write = writes.then(async () => {
        const cache = await open();
        await cache.put(key(hash), new Response(code));
        const keys = await cache.keys();
        for (const request of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) await cache.delete(request);
      });
      writes = write.catch(() => {});
      return write;
    },
  };
}
export type CodeSource = 'bundled code' | 'browser cache' | 'memory cache' | 'RPC';
export class VerifiedCodeCache {
  private memory = new Map<Hex, Hex>();
  private pending = new Map<Hex, Promise<{ code: Hex; source: CodeSource }>>();
  constructor(private store: CodeStore = browserCodeStore(), private seeds: readonly { hash: string; code: string }[] = bundled) {}
  private checked(value: unknown, hash: Hex): Hex {
    if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(value) || value.length > 2 + 2 * MAX_CODE_BYTES) throw new Error('Invalid or oversized contract bytecode.');
    verifyCode(value as Hex, hash);
    return value as Hex;
  }
  async load(expected: Hex, download: () => Promise<unknown>): Promise<{ code: Hex; source: CodeSource }> {
    const hash = expected.toLowerCase() as Hex;
    const cached = this.memory.get(hash);
    if (cached !== undefined) return { code: this.checked(cached, hash), source: 'memory cache' };
    const existing = this.pending.get(hash);
    if (existing) return existing;
    const work = (async () => {
      let code: Hex | undefined;
      let source: CodeSource = 'RPC';
      // Neither bundled files nor browser storage are trust anchors. A corrupt
      // entry is ignored; only bytes matching the freshly proven hash can run.
      const seed = this.seeds.find(entry => entry.hash.toLowerCase() === hash);
      if (seed) { try { code = this.checked(seed.code, hash); source = 'bundled code'; } catch {} }
      if (code === undefined) {
        try {
          const saved = await this.store.get(hash);
          if (saved !== undefined) { code = this.checked(saved, hash); source = 'browser cache'; }
        } catch {} // Storage may be disabled, full, or corrupt.
      }
      if (code === undefined) code = this.checked(await download(), hash);
      this.memory.set(hash, code);
      if (this.memory.size > MAX_ENTRIES) this.memory.delete(this.memory.keys().next().value!);
      if (source === 'RPC') await this.store.put(hash, code).catch(() => {});
      return { code, source };
    })();
    this.pending.set(hash, work);
    try { return await work; } finally { this.pending.delete(hash); }
  }
}
