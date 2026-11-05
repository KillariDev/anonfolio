import { expect, test } from 'bun:test';
import { progressTime, waitingReason } from '../src/verification/progress';
import { privateExecutionRpc } from '../src/verification/transport';

test('elapsed clocks show a bounded deadline, without inventing completion percentages', () => {
  expect(progressTime(1_000, 13_000, 91_000)).toBe('12s elapsed · request timeout in 78s');
  expect(progressTime(1_000, 99_000, 91_000)).toBe('98s elapsed · request timeout in 0s');
  expect(progressTime(1_000, 0)).toBe('0s elapsed');
  expect(waitingReason('consensus')).toContain('balance request not sent');
  expect(waitingReason('queued')).toBe('Queued for the verifier');
});

test('private transport distinguishes response headers from completion of the body', async () => {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { body = controller; } });
  const phases: string[] = [];
  const result = privateExecutionRpc({ fetch: async () => new Response(stream) },
    { rpcUrl: 'https://rpc.example', isolationKey: 'wallet-private-key' },
    { jsonrpc:'2.0', id:1, method:'eth_getProof', params:[] }, undefined, phase => phases.push(phase));
  await Bun.sleep(0);
  expect(phases).toEqual(['reading']);
  body.enqueue(new TextEncoder().encode(JSON.stringify({ jsonrpc:'2.0', id:1, result:{} })));
  body.close();
  await result;
  expect(phases).toEqual(['reading','received']);
});
