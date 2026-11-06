import { expect, test } from 'bun:test';
import { readResponseBytes, readResponseJson, readResponseText } from '../src/response-body';
import { privateExecutionRpc, privateConsensusGet, EXECUTION_RESPONSE_LIMIT, CONSENSUS_RESPONSE_LIMIT } from '../src/verification/transport';
import { CONSENSUS_RPC } from '../src/verification/trust';
import { cacheTorWorker, WORKER_DOWNLOAD_LIMIT } from '../src/worker-update';

function endless(chunkSize = 4) {
  let pulled = 0, cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { pulled++; controller.enqueue(new Uint8Array(chunkSize)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  return { response: (headers?: HeadersInit) => new Response(body, { headers }), get pulled() { return pulled; }, get cancelled() { return cancelled; } };
}
test('decoded streaming limits stop chunked and underreported bodies at the boundary', async () => {
  for (const headers of [undefined, { 'content-length': '1' }]) {
    const stream = endless();
    await expect(readResponseBytes(stream.response(headers), 8, 'Test')).rejects.toThrow('size limit');
    expect(stream.pulled).toBe(3); expect(stream.cancelled).toBe(true);
  }
  const stream = endless();
  await expect(readResponseBytes(stream.response({ 'content-length': '99' }), 8, 'Test')).rejects.toThrow('size limit');
  expect(stream.pulled).toBe(0); expect(stream.cancelled).toBe(true);
});
test('valid bounded bodies decode and invalid UTF-8/JSON are rejected', async () => {
  expect(await readResponseJson(Response.json({ ok: true }), 100, 'Test')).toEqual({ ok: true });
  expect(await readResponseText(new Response('12345678'), 8, 'Test')).toBe('12345678');
  await expect(readResponseText(new Response(new Uint8Array([255])), 8, 'Test')).rejects.toThrow();
  await expect(readResponseJson(new Response('{'), 8, 'Test')).rejects.toThrow();
});
test('abort cancels a stalled body and rejects immediately', async () => {
  const controller = new AbortController(); let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  const read = readResponseBytes(response, 8, 'Test', controller.signal);
  controller.abort(new Error('Cancelled read'));
  await expect(read).rejects.toThrow('Cancelled read');
  expect(cancelled).toBe(true);
});
test('RPC, consensus and manual worker downloads enforce their caps before parsing or hashing', async () => {
  const execution = endless(1024 * 1024);
  await expect(privateExecutionRpc({ fetch: async () => execution.response() },
    { rpcUrl: 'https://rpc.example', isolationKey: 'wallet' },
    { jsonrpc: '2.0', id: 1, method: 'eth_getProof', params: [] })).rejects.toThrow('size limit');
  expect(execution.cancelled).toBe(true);
  expect(execution.pulled).toBe(EXECUTION_RESPONSE_LIMIT / (1024 * 1024) + 1);
  const consensus = endless(1024 * 1024);
  await expect(privateConsensusGet({ fetch: async () => consensus.response() }, 'consensus', CONSENSUS_RPC + '/eth/v1/beacon/light_client/finality_update')).rejects.toThrow('size limit');
  expect(consensus.pulled).toBe(CONSENSUS_RESPONSE_LIMIT / (1024 * 1024) + 1);
  expect(consensus.cancelled).toBe(true);
  const download = endless(1024 * 1024);
  await expect(cacheTorWorker({ hash: ('0x' + '11'.repeat(32)) as `0x${string}`, blockNumber: '0x1', resolvers: ['https://worker.example/'] }, () => {},
    (async () => download.response()) as unknown as typeof fetch)).rejects.toThrow('size limit');
  expect(download.pulled).toBe(Math.floor(WORKER_DOWNLOAD_LIMIT / (1024 * 1024)) + 1);
  expect(download.cancelled).toBe(true);
});
