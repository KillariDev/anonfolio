import { expect, test } from 'bun:test';
import { withDeadline } from '../src/deadline';
function clock() {
  const timers = new Map<number, () => void>(); let next = 0;
  return { timers, set(callback: () => void) { const id = ++next; timers.set(id, callback); return id; }, clear(id: number) { timers.delete(id); }, fire() { for (const callback of [...timers.values()]) callback(); } };
}
test('hard deadline settles a transport that ignores abort and cleans its timer', async () => {
  const time = clock(); let signal: AbortSignal | undefined;
  const request = withDeadline(async input => { signal = input; return new Promise<never>(() => {}); }, 90_000, 'Private read timed out', undefined, time);
  const rejected = request.catch(error => error);
  await Promise.resolve(); time.fire(); expect((await rejected).message).toBe('Private read timed out');
  expect(signal!.aborted).toBe(true); expect(time.timers.size).toBe(0);
});
test('deadline covers a response body that never finishes after headers arrive', async () => {
  const time = clock();
  const request = withDeadline(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } })).json(), 90_000, 'Body read timed out', undefined, time);
  const rejected = request.catch(error => error);
  await Promise.resolve(); time.fire(); expect((await rejected).message).toBe('Body read timed out'); expect(time.timers.size).toBe(0);
});
test('completion and cancellation both release deadline resources', async () => {
  const time = clock();
  expect(await withDeadline(async () => 'ok', 1, 'timeout', undefined, time)).toBe('ok');
  expect(time.timers.size).toBe(0);
  const controller = new AbortController();
  let started = false;
  const request = withDeadline(async () => { started = true; return new Promise<never>(() => {}); }, 1, 'timeout', controller.signal, time);
  const rejected = request.catch(error => error);
  controller.abort(new Error('Cancelled refresh')); expect((await rejected).message).toBe('Cancelled refresh');
  expect(started).toBe(false);
  expect(time.timers.size).toBe(0);
});
