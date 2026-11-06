// Limits apply to decoded bytes, including chunked responses and dishonest
// Content-Length headers. Cancel the stream as soon as it exceeds the budget.
export async function readResponseBytes(response: Response, limit: number, label: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid response size limit.');
  const reject = (message: string): never => {
    void response.body?.cancel().catch(() => {});
    throw new Error(label + ' ' + message);
  };
  if (!response.ok || !response.body) return reject('response unavailable.');
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && BigInt(length) > BigInt(limit)) return reject('response exceeds size limit.');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    signal?.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error(label + ' response exceeds size limit.');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    signal?.removeEventListener('abort', cancel);
    cancel();
  }
}
export async function readResponseText(response: Response, limit: number, label: string, signal?: AbortSignal) {
  return new TextDecoder('utf-8', { fatal: true }).decode(await readResponseBytes(response, limit, label, signal));
}
export async function readResponseJson(response: Response, limit: number, label: string, signal?: AbortSignal): Promise<any> {
  return JSON.parse(await readResponseText(response, limit, label, signal));
}
