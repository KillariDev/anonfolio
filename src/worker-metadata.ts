export type WorkerMetadata = { hash: `0x${string}`; resolvers: string[]; blockNumber: string };
export function validateWorkerMetadata(value: unknown): WorkerMetadata {
  const data = value as Partial<WorkerMetadata> | null;
  if (!data || typeof data.hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(data.hash) || /^0x0{64}$/i.test(data.hash)) throw new Error('Tor worker hash must be a nonzero 32-byte digest.');
  if (typeof data.blockNumber !== 'string' || !/^0x[0-9a-f]+$/i.test(data.blockNumber)) throw new Error('Invalid Tor worker discovery block.');
  if (!Array.isArray(data.resolvers) || !data.resolvers.length || data.resolvers.length > 8) throw new Error('Tor worker must have 1–8 HTTPS download locations.');
  const resolvers = data.resolvers.map(value => {
    try {
      if (typeof value !== 'string') throw new Error();
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error();
      return url.href;
    } catch { throw new Error('Tor worker download locations must be HTTPS URLs without credentials or fragments.'); }
  });
  return { hash: data.hash.toLowerCase() as WorkerMetadata['hash'], resolvers: [...new Set(resolvers)], blockNumber: data.blockNumber };
}
