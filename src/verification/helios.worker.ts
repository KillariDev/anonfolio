/// <reference lib="webworker" />
import type { VerificationStage } from './progress';
import initWasm, { EthereumClient } from '../../vendor/helios/index.js';
import { setHeliosFetch } from '../../vendor/helios/fetch.js';
import { DEFAULT_CHECKPOINT, validateCheckpoint, assertCheckpointSlot, type Checkpoint, CONSENSUS_RPC, HELIOS_WASM_SHA256, checkCheckpointAge, verifiedBlock, type VerifiedBlock } from './trust';
import { assertPinnedBlock, verifyAccountResponse } from './proofs';
import { TwapOracle, V3_FACTORY } from '../pricing';
import { assertConsensusUrl, type RpcRequest } from './transport';
import { downloadVerifier } from './download';
import { RequestPurposes } from './request-purpose';
import { parallelReads } from './parallel';
import { VerifiedCodeCache } from './code-cache';
import { executionCode } from './execution-code';
import type { HeliosStatus } from './status';

let activeCheckpoint: Checkpoint = DEFAULT_CHECKPOINT;
const EXECUTION_URL = 'https://helios-execution.invalid/';
const scope = self as unknown as DedicatedWorkerGlobalScope;
let current: { id: string; rpcHost: string; mode?: 'tor'|'https'; purposes: RequestPurposes; block?: VerifiedBlock } | undefined;
let client: EthereumClient | undefined;
const oracle = new TwapOracle();
const codeCache = new VerifiedCodeCache();
let sequence = 0;
let executionFailure = '';
let queue = Promise.resolve();
const replies = new Map<number, { resolve: (data: any) => void; reject: (error: Error) => void }>();
const codeHashes = new Map<string, `0x${string}`>();
const send = (type: string, extra: object = {}) => scope.postMessage({ type, run: current?.id, ...extra });
const lightClientStatus = (status: HeliosStatus) => scope.postMessage({ type: 'helios-status', status });
const step = (message: string, stage?: VerificationStage) => send('progress', { message, ...(stage ? { stage } : {}) });
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
  send('rpc', { id, body, ...current.purposes.describe(body) });
  const result = await response;
  if (current?.id !== run) throw new Error('Obsolete wallet execution response.');
  return result;
}
async function internalFetch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.href !== EXECUTION_URL) {
    assertConsensusUrl(url.href);
    if (request.method !== 'GET') throw new Error('Disallowed consensus method.');
    const syncingRun = current && !current.block ? current.id : undefined;
    if (syncingRun) step('Requesting consensus data from ' + url.hostname + (current?.mode === 'https' ? ' through direct HTTPS. No wallet balance request has been sent yet.' : ' through Anon-RPC. No wallet balance request has been sent yet.'), 'consensus');
    const id = ++sequence;
    const reply = new Promise<{ status: number; body: string }>((resolve, reject) => replies.set(id, { resolve, reject }));
    scope.postMessage({ type: 'consensus', id, url: url.href });
    const data = await reply;
    if (syncingRun && current?.id === syncingRun && !current.block) step('Consensus response received; validating sync committee signatures and finalized headers.', 'consensus');
    if (url.pathname.includes('/light_client/bootstrap/')) {
      if (url.pathname.split('/').at(-1)?.toLowerCase() !== activeCheckpoint.root) throw new Error('Unexpected consensus checkpoint bootstrap root.');
      assertCheckpointSlot(JSON.parse(data.body), activeCheckpoint);
    }
    const response = new Response(data.body, { status: data.status, headers: { 'content-type': 'application/json' } });
    Object.defineProperty(response, 'url', { value: url.href });
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
  const purpose = current!.purposes.describe(body).purpose;
  if (body.method === 'eth_getCode') {
    const { code, source } = await executionCode(body, current!.block!, codeHashes, rpc, codeCache);
    step(purpose + ': ' + (source === 'RPC' ? 'downloaded code' : source) + ' matches proven account; executing locally.');
    return rpcResponse({ jsonrpc: '2.0', id: body.id, result: code });
  }
  let data;
  try { data = await rpc(body); } catch (error) { step(purpose + ' failed: ' + String(error)); throw error; }
  if (body.method === 'eth_getProof') {
    step('Verifying ' + purpose + '.');
    const hash = await verifyAccountResponse(body.params[0], body.params[1], current!.block!, data.result);
    codeHashes.set(body.params[0].toLowerCase(), hash);
  }
  return rpcResponse(data);
}
setHeliosFetch(request => internalFetch(request).catch(error => {
  executionFailure = String(error);
  // A rejected witness invalidates this refresh, including parallel oracle work.
  // Stop immediately rather than attributing a shared transport error to another lane.
  send('fatal', { error: executionFailure });
  throw error;
}));
async function synced(checkpoint: Checkpoint) {
  const selected = validateCheckpoint(checkpoint);
  checkCheckpointAge(Date.now(), selected);
  if (client && (selected.root !== activeCheckpoint.root || selected.slot !== activeCheckpoint.slot)) throw new Error('Consensus checkpoint changed; reconnect to restart the shared verifier.');
  if (!client) {
    activeCheckpoint = selected;
    step('Downloading the pinned Helios verifier from this application.', 'verifier');
    const bytes = await downloadVerifier(new URL('../../vendor/helios/index_bg.wasm', import.meta.url));
    step('Verifier downloaded; checking its SHA-256 integrity before initialization.', 'verifier');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
    if (hash !== HELIOS_WASM_SHA256) throw new Error('Helios WASM digest mismatch.');
    await initWasm({ module_or_path: bytes });
    step('Bootstrapping shared consensus light client from ' + (activeCheckpoint.root === DEFAULT_CHECKPOINT.root && activeCheckpoint.slot === DEFAULT_CHECKPOINT.slot ? 'the release-pinned' : 'your configured') + ' checkpoint at slot ' + activeCheckpoint.slot + '.', 'consensus');
    // Memory DB prevents an older persisted client from replacing the selected root.
    client = new EthereumClient(EXECUTION_URL, undefined, CONSENSUS_RPC, 'mainnet', activeCheckpoint.root, 'config');
    lightClientStatus({ phase: 'syncing' });
    await client.wait_synced();
  }
  return client;
}
async function refresh(message: any) {
  current = { id: message.id, rpcHost: message.rpcHost, mode: message.mode, purposes: new RequestPurposes(message.address, message.tokens, message.pricing) };
  codeHashes.clear();
  executionFailure = '';
  try {
    const helios = await synced(message.checkpoint);
    step('Consensus synchronized; selecting one verified finalized block for this refresh.', 'consensus');
    const block = verifiedBlock(await helios.get_block_by_number('finalized', false));
    current.block = block;
    lightClientStatus({ phase: 'ready', block });
    send('block', { block });
    step('Verified finalized block ' + BigInt(block.number) + ' selected for every balance in this refresh.', 'balances');
    let stage: VerificationStage = 'balances-pricing';
    await parallelReads(message.tokens, async token => {
      send('asset', { asset: token.address, stage });
      try {
        let amount: bigint;
        const decimals = token.decimals;
        if (token.address === 'eth') {
          step('ETH: requesting wallet account proof and verifying its balance against the finalized state root.');
          amount = BigInt(await helios.get_balance(message.address, { blockHash: block.hash }));
        } else {
          step(token.symbol + ': executing balanceOf(wallet) locally; fetching only missing proven code/storage through the selected transport.');
          const call = { to: token.address, input: '0x70a08231' + message.address.slice(2).toLowerCase().padStart(64, '0'), gas: '0x989680' };
          const output = await helios.call(call, { blockHash: block.hash }, undefined);
          if (!/^0x[0-9a-f]{64}$/i.test(output)) throw new Error('Invalid balanceOf return value.');
          amount = BigInt(output);

        }
        send('balance', { asset: token.address, amount: amount.toString(), decimals, block });
      } catch (error) { send('asset-error', { asset: token.address, error: String(error), message: token.symbol + ' balance verification at finalized block ' + BigInt(block.number) }); }
    }, async token => {
      send('price-start', { asset: token.address, stage });
      try {
        const estimate = await oracle.estimate(token, message.pricing, block, async (to, input) => {
          if (to.toLowerCase() !== V3_FACTORY.toLowerCase()) current!.purposes.name(to, (token.address === 'eth' ? 'WETH' : token.symbol) + '/' + message.pricing.quote.symbol + ' pool');
          return await helios.call({ to, input, gas: '0x989680' }, { blockHash: block.hash }, undefined) as `0x${string}`;
        }, message => step(message));
        send('price', { asset: token.address, estimate, block });
      } catch (error) { send('price-error', { asset: token.address, error: String(error) }); }
    }, nextStage => {
      stage = nextStage;
      step(nextStage === 'balances-pricing' ? 'Proving balances and reading verified price oracles in parallel at the selected finalized block.' : nextStage === 'pricing' ? 'Balance proofs finished; waiting for verified price estimates.' : 'Price queries finished; waiting for balance proofs.', nextStage);
    });
    send('done');
  } catch (error) { send('fatal', { error: executionFailure || String(error) }); }
  finally { current = undefined; codeHashes.clear(); }
}
scope.onmessage = event => {
  const message = event.data;
  if(message.type === 'rpc-operator') { if(current && current.id===message.run) current.rpcHost=message.host; return; }
  if (message.type === 'reply' || message.type === 'consensus-reply') {
    const reply = replies.get(message.id);
    replies.delete(message.id);
    if (message.error) reply?.reject(new Error(message.error)); else reply?.resolve(message.data);
  } else if (message.type === 'refresh') {
    queue = queue.then(() => refresh(message)).catch(error => send('fatal', { error: String(error) }));
  }
};
