import { V3_FACTORY, WETH_USDC_POOL, type PricingSettings } from '../pricing';
import type { Token } from '../tokens';
import type { RpcRequest } from './transport';

// Describe the actual target, not a global "current token": balance and pricing
// lanes can fetch dependencies concurrently and must never borrow each other's label.
export class RequestPurposes {
  private labels = new Map<string, string>();
  constructor(wallet: string, tokens: Token[], pricing: PricingSettings) {
    this.name(wallet, 'Tracked address');
    this.name(pricing.quote.address, pricing.quote.symbol);
    for (const token of tokens) if (token.address !== 'eth') this.name(token.address, token.symbol);
    this.name(V3_FACTORY, 'Uniswap factory');
    this.name(WETH_USDC_POOL, 'WETH/USDC pool');
  }
  name(address: string, label: string) { this.labels.set(address.toLowerCase(), label); }
  describe(body: RpcRequest): { purpose: string; target?: string } {
    const target = typeof body.params?.[0] === 'string' ? body.params[0] : undefined;
    const name = target ? this.labels.get(target.toLowerCase()) || 'Contract ' + target.slice(0, 6) + '…' + target.slice(-4) : 'Contract';
    if (body.method === 'eth_getProof') {
      const slots = Array.isArray(body.params[1]) ? body.params[1].length : 0;
      return { target, purpose: name + (slots ? ' storage proof · ' + slots + (slots === 1 ? ' slot' : ' slots') : ' account proof') };
    }
    if (body.method === 'eth_getCode') return { target, purpose: name + ' bytecode' };
    if (body.method === 'eth_getBlockByHash' || body.method === 'eth_getBlockByNumber') return { purpose: 'Block header' };
    return { purpose: body.method };
  }
}
