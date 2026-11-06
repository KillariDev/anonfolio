import { V3_FACTORY, WETH_USDC_POOL, type PricingSettings } from '../pricing';
import type { Token } from '../tokens';
import type { RpcRequest } from './transport';

export function consensusPurpose(url: string) {
  const { pathname, searchParams } = new URL(url);
  if (pathname.includes('/bootstrap/')) {
    const root = pathname.split('/').at(-1)!;
    return 'Consensus bootstrap ' + root.slice(0, 10) + '…' + root.slice(-4);
  }
  if (pathname.endsWith('/updates')) return 'Consensus updates · period ' + (searchParams.get('start_period') || '?') + ' × ' + (searchParams.get('count') || '?');
  if (pathname.endsWith('/finality_update')) return 'Consensus finality update';
  if (pathname.endsWith('/optimistic_update')) return 'Consensus optimistic update';
  return 'Consensus data';
}

// Describe the actual target, not a global "current token": balance and pricing
// lanes can fetch dependencies concurrently and must never borrow each other's label.
export class RequestPurposes {
  private labels = new Map<string, string>();
  // Display metadata only. These labels never authorize a block or proof.
  private blocks = new Map<string, string>();
  constructor(wallet: string, tokens: Token[], pricing: PricingSettings) {
    this.name(wallet, 'Tracked address');
    this.name(pricing.quote.address, pricing.quote.symbol);
    for (const token of tokens) if (token.address !== 'eth') this.name(token.address, token.symbol);
    this.name(V3_FACTORY, 'Uniswap factory');
    this.name(WETH_USDC_POOL, 'WETH/USDC pool');
  }
  name(address: string, label: string) { this.labels.set(address.toLowerCase(), label); }
  rememberBlock(hash: unknown, number: unknown) {
    if (typeof hash !== 'string' || !/^0x[\da-f]{64}$/i.test(hash) || typeof number !== 'string' || !/^(?:0x[\da-f]{1,16}|\d{1,20})$/i.test(number)) return;
    this.blocks.set(hash.toLowerCase(), BigInt(number).toString());
  }
  rememberConsensus(value: unknown, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 6) return;
    if (Array.isArray(value)) { for (const item of value.slice(0, 128)) this.rememberConsensus(item, depth + 1); return; }
    const node = value as Record<string, unknown>;
    this.rememberBlock(node.block_hash, node.block_number);
    for (const key of ['data', 'header', 'attested_header', 'finalized_header', 'execution']) this.rememberConsensus(node[key], depth + 1);
  }
  describe(body: RpcRequest): { purpose: string; target?: string } {
    const target = typeof body.params?.[0] === 'string' ? body.params[0] : undefined;
    if (body.method === 'eth_getBlockByNumber') {
      const number = target && /^0x[\da-f]+$/i.test(target) ? '#' + BigInt(target) : target || 'unknown';
      return { purpose: 'Block header ' + number };
    }
    if (body.method === 'eth_getBlockByHash') {
      const number = target && this.blocks.get(target.toLowerCase());
      return { purpose: 'Block header ' + (number ? '#' + number : target ? target.slice(0, 10) + '…' + target.slice(-4) : 'unknown') };
    }
    const name = target ? this.labels.get(target.toLowerCase()) || 'Contract ' + target.slice(0, 6) + '…' + target.slice(-4) : 'Contract';
    if (body.method === 'eth_getProof') {
      const slots = Array.isArray(body.params[1]) ? body.params[1].length : 0;
      return { target, purpose: name + (slots ? ' storage proof · ' + slots + (slots === 1 ? ' slot' : ' slots') : ' account proof') };
    }
    if (body.method === 'eth_getCode') return { target, purpose: name + ' bytecode' };
    return { purpose: body.method };
  }
}
