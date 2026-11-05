type Timer = { set: (callback: () => void, milliseconds: number) => unknown; clear: (id: any) => void };
const timer: Timer = { set: (callback, milliseconds) => setTimeout(callback, milliseconds), clear: id => clearTimeout(id) };
// Abort is advisory to third-party transports. Race the entire operation too,
// including streamed body reads, so an ignored signal cannot leave UI pending.
export async function withDeadline<T>(run: (signal: AbortSignal) => Promise<T>, milliseconds: number, message: string, parent?: AbortSignal, clock: Timer = timer): Promise<T> {
  const controller = new AbortController();
  let handle: unknown;
  let onAbort: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => { const error = parent?.reason || new Error('Request cancelled.'); controller.abort(error); reject(error); };
    parent?.addEventListener('abort', onAbort, { once: true });
    if (parent?.aborted) { onAbort(); return; }
    handle = clock.set(() => { const error = new Error(message); controller.abort(error); reject(error); }, milliseconds);
  });
  try {
    if (controller.signal.aborted) return await stopped;
    return await Promise.race([Promise.resolve().then(() => {
      if (controller.signal.aborted) throw controller.signal.reason;
      return run(controller.signal);
    }), stopped]);
  } finally {
    if (handle !== undefined) clock.clear(handle);
    if (onAbort) parent?.removeEventListener('abort', onAbort);
  }
}
