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
  expect(proof.summary).toBe('RPC proof history unavailable');
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
