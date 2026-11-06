import { expect, test } from 'bun:test';
import { RetryQueue, retryDelay } from '../src/retries';

function setup(run: (key: string) => void | Promise<void> = () => {}) {
  let now = 10_000;
  let online = true;
  const jobs = new Map<symbol, { due: number; callback: () => void }>();
  const calls: string[] = [];
  const queue = new RetryQueue<string>(
    key => { calls.push(key); return run(key); }, () => online, () => {},
    {
      now: () => now,
      schedule(callback, delay) {
        const key = Symbol();
        jobs.set(key, { due: now + delay, callback });
        return () => { jobs.delete(key); };
      },
    },
  );
  return {
    queue, calls, jobs,
    online(value: boolean) { online = value; },
    async advance(ms: number) {
      now += ms;
      for (const [key, job] of [...jobs]) if (job.due <= now) { jobs.delete(key); job.callback(); }
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}
test('retry delays increase and cap at one minute', () => {
  expect([1, 2, 3, 4, 5, 6, 100].map(retryDelay)).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000]);
});
test('one scheduled attempt per address; cancellation prevents a request', async () => {
  const { queue, jobs, calls, advance } = setup();
  queue.schedule('wallet');
  queue.schedule('wallet');
  expect(jobs.size).toBe(1);
  expect(queue.info('wallet')!.attempt).toBe(1);
  queue.cancel('wallet');
  await advance(60_000);
  expect(calls).toEqual([]);
  queue.schedule('wallet');
  expect(queue.info('wallet')!.attempt).toBe(1);
});
test('each failed round backs off independently and a successful round can reset attempts', async () => {
  const state = setup(key => { state.queue.schedule(key); });
  state.queue.schedule('a');
  state.queue.schedule('b');
  await state.advance(2000);
  expect(state.calls).toEqual(['a', 'b']);
  expect(state.queue.info('a')!.attempt).toBe(2);
  state.queue.cancel('b');
  await state.advance(4000);
  expect(state.calls).toEqual(['a', 'b', 'a']);
  expect(state.queue.info('a')!.attempt).toBe(3);
  state.queue.cancel('a');
  state.queue.schedule('a');
  expect(state.queue.info('a')!.attempt).toBe(1);
});
test('offline retries send nothing and resume immediately when the network returns', async () => {
  const state = setup();
  state.online(false);
  state.queue.schedule('wallet');
  expect(state.queue.info('wallet')!.dueAt).toBeUndefined();
  expect(state.jobs.size).toBe(0);
  await state.advance(60_000);
  expect(state.calls).toEqual([]);
  state.online(true);
  state.queue.resume();
  await state.advance(0);
  expect(state.calls).toEqual(['wallet']);
  expect(state.queue.info('wallet')).toBeUndefined();
});
test('pausing cancels timers, including new retries queued while the page is suspended', async () => {
  const state = setup();
  state.queue.schedule('a');
  state.queue.pause();
  state.queue.schedule('b');
  expect(state.jobs.size).toBe(0);
  await state.advance(60_000);
  expect(state.calls).toEqual([]);
  state.queue.cancel('b');
  state.queue.resume();
  await state.advance(0);
  expect(state.calls).toEqual(['a']);
});

test('connection recovery caps its pause at ten seconds without speeding up wallet RPC retries', () => {
  const delays: number[] = [];
  const queue = new RetryQueue<string>(() => {}, () => true, () => {}, {
    now: () => 0,
    schedule: (_, delay) => { delays.push(delay); return () => {}; },
  }, (attempt, key) => key === 'connection' ? Math.min(retryDelay(attempt), 10_000) : retryDelay(attempt));
  for (const key of ['connection', 'wallet']) for (let i = 0; i < 7; i++) { queue.schedule(key); queue.begin(key); }
  expect(delays).toEqual([2000,4000,8000,10000,10000,10000,10000,2000,4000,8000,16000,32000,60000,60000]);
});
