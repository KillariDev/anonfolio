import { expect, test } from 'bun:test';
import { errorMessage, explainFailure, readFailure } from '../src/errors';

test('error messages preserve causes while redacting endpoint credentials and bounding output', () => {
  const failure = readFailure(new Error('Error: Error: Request failed at https://user:password@rpc.example/v1/api-secret?key=query-secret', { cause: new Error('HTTP 403') }), 'POST https://rpc.example/token-secret');
  expect(failure.message).toContain('HTTP 403'); expect(failure.message).toContain('https://rpc.example/[redacted]');
  expect(JSON.stringify(failure)).not.toMatch(/password|api-secret|query-secret|token-secret/);
  expect(failure.message).not.toStartWith('Error:');
  expect(errorMessage('x'.repeat(5000))).toHaveLength(1200);
  expect(errorMessage(undefined)).toBe('No error details were returned.');
});
test('checkpoint expiry and proof-window rejection have different actionable explanations', () => {
  const checkpoint = explainFailure(readFailure('Pinned consensus checkpoint is outside its 14-day trust window. A reviewed checkpoint update is required.'));
  expect(checkpoint.summary).toBe('Consensus checkpoint needs updating');
  expect(checkpoint.action).toContain('updated application release');
  const proof = explainFailure(readFailure('Private eth_getProof rejected (-32602): distance to target block exceeds maximum proof window'));
  expect(proof.summary).toBe('RPC cannot prove this finalized block');
  expect(proof.action).toContain('Settings → Network connection');
});
test('errors distinguish public consensus, offline, rate limits, timeouts and invalid proofs', () => {
  for (const [message, summary] of [
    ['Consensus GET beacon.example/eth/v1/beacon/light_client/updates returned HTTP 503', 'Consensus API unavailable'],
    ['Browser is offline.', 'Browser is offline'], ['Private RPC returned HTTP 429', 'RPC rate limit reached'],
    ['Private RPC returned HTTP 403', 'RPC access denied'], ['Verification timed out', 'Verification timed out'],
    ['Bytecode hash does not match the verified account.', 'Proof verification rejected'],
    ['Helios WASM digest mismatch.', 'Verifier integrity check failed'],
  ]) expect(explainFailure(readFailure(message)).summary).toBe(summary!);
});

test('worker error records retain nested causes and codes without exposing URLs or payloads', () => {
  const failure = errorMessage({ message: 'Private connection unavailable; no unverified fallback.', code: 'PRIVATE_ROUTE_FAILED',
    cause: { message: 'Gateway handshake failed at https://user:secret@gateway.example/api-key?token=secret', cause: { message: 'Connection refused', code: 'ECONNREFUSED' } },
    body: 'wallet request must not be serialized',
  });
  expect(failure).toContain('PRIVATE_ROUTE_FAILED');
  expect(failure).toContain('Gateway handshake failed');
  expect(failure).toContain('Connection refused (ECONNREFUSED)');
  expect(failure).not.toMatch(/secret|api-key|wallet request/);
  const cycle: any = { message: 'Circular cause' }; cycle.cause = cycle;
  expect(errorMessage(cycle)).toBe('Circular cause');
});

test('private transport failures identify request, endpoint and worker cause without public fallback', async () => {
  const { privateExecutionRpc, privateConsensusGet } = await import('../src/verification/transport');
  const { CONSENSUS_RPC } = await import('../src/verification/trust');
  const calls: any[] = [];
  const worker = { fetch: async (url: any, init: any) => {
    calls.push({ url, key: init.anonOptions.isolationKey });
    throw { message: 'Private connection unavailable; no unverified fallback.', cause: { message: 'Circuit construction failed', code: 'TOR_TIMEOUT' } };
  } };
  await expect(privateExecutionRpc(worker, { rpcUrl: 'https://rpc.example/api-secret', isolationKey: 'wallet-key' },
    { jsonrpc: '2.0', id: 1, method: 'eth_getProof', params: [] })).rejects.toThrow('Private eth_getProof to rpc.example failed: Private connection unavailable; no unverified fallback. · Circuit construction failed (TOR_TIMEOUT)');
  await expect(privateConsensusGet(worker, 'consensus-key', CONSENSUS_RPC + '/eth/v1/beacon/light_client/finality_update')).rejects.toThrow('Circuit construction failed (TOR_TIMEOUT)');
  expect(calls.map(call => call.key)).toEqual(['wallet-key', 'consensus-key']);
});

test('interrupted response bodies identify the private request instead of a bare Failed to fetch', async () => {
  const { privateExecutionRpc, privateConsensusGet } = await import('../src/verification/transport');
  const { CONSENSUS_RPC } = await import('../src/verification/trust');
  const worker = { fetch: async () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('Failed to fetch')); } })) };
  await expect(privateExecutionRpc(worker, { rpcUrl: 'https://rpc.example/', isolationKey: 'wallet-key' },
    { jsonrpc: '2.0', id: 1, method: 'eth_getProof', params: [] })).rejects.toThrow('Private eth_getProof response from rpc.example could not be read: Failed to fetch');
  await expect(privateConsensusGet(worker, 'consensus-key', CONSENSUS_RPC + '/eth/v1/beacon/light_client/bootstrap/0x123')).rejects.toThrow('Consensus GET ethereum-beacon-api.publicnode.com/eth/v1/beacon/light_client/bootstrap/0x123 response could not be read: Failed to fetch');
});

test('verifier asset failures name the application host, including interrupted downloads', async () => {
  const { downloadVerifier } = await import('../src/verification/download');
  const url = new URL('https://app.example/assets/verifier.wasm');
  await expect(downloadVerifier(url, async () => { throw new TypeError('Failed to fetch'); })).rejects.toThrow('Helios WASM download from app.example failed: Failed to fetch');
  await expect(downloadVerifier(url, async () => new Response('', { status: 404 }))).rejects.toThrow('app.example failed: HTTP 404');
  await expect(downloadVerifier(url, async () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('Failed to fetch')); } })))).rejects.toThrow('app.example failed: Failed to fetch');
});

test('failure destinations distinguish consensus, verifier assets and execution; bare fetch failures identify no endpoint', async () => {
  const { failureEndpoint } = await import('../src/errors');
  expect(failureEndpoint(readFailure('Consensus GET beacon.example/eth/v1/beacon/light_client/bootstrap/0x123 response could not be read: Failed to fetch'), 'rpc.example')).toEqual({ label: 'Consensus API', host: 'beacon.example' });
  expect(failureEndpoint(readFailure('Helios WASM download from app.example failed: Failed to fetch'), 'rpc.example')).toEqual({ label: 'Application host', host: 'app.example' });
  expect(failureEndpoint(readFailure('Private eth_getProof response from actual-rpc.example could not be read: Failed to fetch'), 'other.example')).toEqual({ label: 'RPC', host: 'actual-rpc.example' });
  expect(failureEndpoint(readFailure('Failed to fetch'), 'rpc.example')).toBeUndefined();
  expect(explainFailure(readFailure('Private eth_getProof response from rpc.example could not be read: Failed to fetch')).summary).toBe('RPC response interrupted');
});
