/// <reference lib="webworker" />
import initWasm, { EthereumClient } from '../../vendor/helios/index.js';
import { setHeliosFetch } from '../../vendor/helios/fetch.js';
import { CHECKPOINT, CONSENSUS_RPC, HELIOS_WASM_SHA256, checkCheckpointAge, verifiedBlock, type VerifiedBlock } from './trust';
import { assertPinnedBlock, verifyAccountResponse, verifyCode } from './proofs';
import { TwapOracle } from '../pricing';
import type { RpcRequest } from './transport';

const EXECUTION_URL = 'https://helios-execution.invalid/';
const scope = self as unknown as DedicatedWorkerGlobalScope;
let current: { id: string; rpcHost: string; requests: number; block?: VerifiedBlock } | undefined;
let client: EthereumClient | undefined;
const oracle = new TwapOracle();
let sequence = 0;
let executionFailure = '';
let queue = Promise.resolve();
const replies = new Map<number, { resolve: (data: any) => void; reject: (error: Error) => void }>();
const codeHashes = new Map<string, `0x${string}`>();
const send = (type: string, extra: object = {}) => scope.postMessage({ type, run: current?.id, ...extra });
const step = (message: string) => send('progress', { message });
function rpcResponse(data: unknown) {
  const response = Response.json(data);
  // Reqwest's WASM adapter parses Response.url; synthetic responses need it too.
  Object.defineProperty(response, 'url', { value: EXECUTION_URL });
  return response;
}
async function rpc(body: RpcRequest) {
  if (!current) throw new Error('Wallet execution outside an active private refresh is forbidden.');
  const run = current.id;
  const id = ++sequence;
  const response = new Promise<any>((resolve, reject) => replies.set(id, { resolve, reject }));
  send('rpc', { id, body });
  const result = await response;
  if (current?.id !== run) throw new Error('Obsolete wallet execution response.');
  return result;
}
async function internalFetch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.href !== EXECUTION_URL) {
    if (url.origin !== CONSENSUS_RPC || request.method !== 'GET'
      || !/^\/eth\/v[12]\/(beacon\/(light_client\/|blocks\/|genesis)|config\/spec)/.test(url.pathname)) throw new Error('Helios attempted a network escape.');
    step('Consensus: GET ' + url.hostname + url.pathname + ' (no wallet addresses). Verifying sync committee signatures and finalized headers.');
    const response = await fetch(request);
    if (!response.ok) throw new Error('Consensus GET ' + url.hostname + url.pathname + ' returned HTTP ' + response.status);
    return response;
  }
  const body = await request.json() as RpcRequest;
  if (Array.isArray(body)) throw new Error('Execution batches are forbidden.');
  // Access lists are untrusted hints; demand-load and verify every dependency instead.
  if (body.method === 'eth_createAccessList') return rpcResponse({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Use verified demand-loaded state' } });
  if (body.method === 'eth_getProof' || body.method === 'eth_getCode') {
    if (!current?.block) throw new Error('State request before verified finalized block selection.');
    assertPinnedBlock(body.params.at(-1), current.block);
  } else if (!['eth_getBlockByHash', 'eth_getBlockByNumber'].includes(body.method)) throw new Error('Unreviewed Helios RPC method.');
  step('Private ' + body.method + ' request #' + (++current!.requests) + ' → ' + current!.rpcHost + ' through Anon-RPC; waiting for response.');
  let data;
  try { data = await rpc(body); } catch (error) { step('Private ' + body.method + ' failed: ' + String(error)); throw error; }
  if (body.method === 'eth_getProof') {
    step('Checking account and requested storage proofs against finalized state root.');
    const hash = await verifyAccountResponse(body.params[0], body.params[1], current!.block!, data.result);
    codeHashes.set(body.params[0].toLowerCase(), hash);
  } else if (body.method === 'eth_getCode') {
    let hash = codeHashes.get(body.params[0].toLowerCase());
    if (!hash) {
      // Helios can retain a verified account across refreshes while lazily loading
      // its code. Reprove the account on this route if the adapter has no witness.
      const witness = await rpc({ ...body, method: 'eth_getProof', params: [body.params[0], [], body.params[1]] });
      hash = await verifyAccountResponse(body.params[0], [], current!.block!, witness.result);
      codeHashes.set(body.params[0].toLowerCase(), hash);
    }
    verifyCode(data.result, hash);
    step('Bytecode hash verified. Helios is executing locally with proven state, including proxy dependencies.');
  }
  return rpcResponse(data);
}
setHeliosFetch(request => internalFetch(request).catch(error => {
  executionFailure = String(error);
  step('Verification transport rejected a request: ' + executionFailure);
  throw error;
}));
async function synced() {
  if (!client) {
    checkCheckpointAge();
    step('Loading pinned Helios 0.12.0 WASM verifier.');
    const download = await fetch(new URL('../../vendor/helios/index_bg.wasm', import.meta.url));
    if (!download.ok) throw new Error('Helios WASM download failed (HTTP ' + download.status + ').');
    const bytes = await download.arrayBuffer();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
    if (hash !== HELIOS_WASM_SHA256) throw new Error('Helios WASM digest mismatch.');
    await initWasm({ module_or_path: bytes });
    step('Bootstrapping shared consensus light client from independently pinned checkpoint ' + CHECKPOINT + '.');
    // Memory DB prevents a browser-supplied checkpoint from replacing the pinned root.
    client = new EthereumClient(EXECUTION_URL, undefined, CONSENSUS_RPC, 'mainnet', CHECKPOINT, 'config');
    await client.wait_synced();
  }
  return client;
}
async function refresh(message: any) {
  current = { id: message.id, rpcHost: message.rpcHost, requests: 0 };
  codeHashes.clear();
  executionFailure = '';
  try {
    const helios = await synced();
    const block = verifiedBlock(await helios.get_block_by_number('finalized', false));
    current.block = block;
    send('block', { block });
    step('Pinned verified finalized block ' + BigInt(block.number) + ' (' + block.hash + ').');
    const pricedTokens = [];
    for (const token of message.tokens) {
      executionFailure = '';
      send('asset', { asset: token.address });
      try {
        let amount: bigint;
        let decimals = token.decimals;
        let decimalsVerified = token.address === 'eth';
        if (token.address === 'eth') {
          step('ETH: requesting wallet account proof and verifying its balance against the finalized state root.');
          amount = BigInt(await helios.get_balance(message.address, { blockHash: block.hash }));
        } else {
          step(token.symbol + ': executing balanceOf(wallet) locally; fetching only missing proven code/storage through the private route.');
          const call = { to: token.address, input: '0x70a08231' + message.address.slice(2).toLowerCase().padStart(64, '0'), gas: '0x989680' };
          const output = await helios.call(call, { blockHash: block.hash }, undefined);
          if (!/^0x[0-9a-f]{64}$/i.test(output)) throw new Error('Invalid balanceOf return value.');
          amount = BigInt(output);
          try {
            step(token.symbol + ': locally verifying decimals() at the same finalized block.');
            const result = await helios.call({ to: token.address, input: '0x313ce567', gas: '0x989680' }, { blockHash: block.hash }, undefined);
            if (!/^0x[0-9a-f]{64}$/i.test(result) || BigInt(result) > 255n) throw new Error('Invalid decimals return value.');
            decimals = Number(BigInt(result)); decimalsVerified = true;
          } catch { step(token.symbol + ': decimals() unavailable; displayed decimals remain explicitly user-supplied.'); }
        }
        send('balance', { asset: token.address, amount: amount.toString(), decimals, decimalsVerified, block });
        pricedTokens.push(token);
      } catch (error) { send('asset-error', { asset: token.address, error: executionFailure || String(error) }); }
    }
    // Oracle outages must not delay proving the remaining wallet balances.
    for (const token of pricedTokens) {
      try {
        const estimate = await oracle.estimate(token, message.pricing, block, async (to, input) => {
          executionFailure = '';
          return await helios.call({ to, input, gas: '0x989680' }, { blockHash: block.hash }, undefined) as `0x${string}`;
        }, step);
        send('price', { asset: token.address, estimate, block });
      } catch (error) { send('price-error', { asset: token.address, error: executionFailure || String(error) }); }
    }
    send('done');
  } catch (error) { send('fatal', { error: executionFailure || String(error) }); }
  finally { current = undefined; codeHashes.clear(); }
}
scope.onmessage = event => {
  const message = event.data;
  if (message.type === 'reply') {
    const reply = replies.get(message.id);
    replies.delete(message.id);
    if (message.error) reply?.reject(new Error(message.error)); else reply?.resolve(message.data);
  } else if (message.type === 'refresh') {
    queue = queue.then(() => refresh(message)).catch(error => send('fatal', { error: String(error) }));
  }
};
