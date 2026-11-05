import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi, parseUnits, zeroAddress, type Address, type Hex } from 'viem';
import { WETH } from './config';
import { validateToken, type Token } from './tokens';
import type { VerifiedBlock } from './verification/trust';

export const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address;
export const V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984' as Address;
export const WETH_USDC_POOL = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640' as Address;
export const WINDOW = 1800;
export const PRICING_KEY = 'anonfolio.pricing.v1';
export type PricingSettings = { quote: Token & { address: Address }; minLiquidity: string };
export const defaultPricing = (): PricingSettings => ({ quote: { address: USDC, symbol: 'USDC', decimals: 6 }, minLiquidity: '10000' });
export function validatePricing(value: unknown): PricingSettings {
  const data = value as PricingSettings;
  if (!data?.quote || data.quote.address === ('eth' as string)) throw new Error('Choose an ERC-20 quote token.');
  const quote = validateToken(data.quote.address, data.quote.symbol, String(data.quote.decimals));
  if (!/^\d{1,24}(\.\d{1,18})?$/.test(data.minLiquidity) || !/[1-9]/.test(data.minLiquidity)) throw new Error('Minimum quote liquidity must be a positive decimal amount.');
  if ((data.minLiquidity.split('.')[1]?.length || 0) > quote.decimals) throw new Error('Liquidity amount exceeds quote token precision.');
  return { quote: quote as PricingSettings['quote'], minLiquidity: data.minLiquidity };
}
export function loadPricing(): PricingSettings {
  try { const saved = localStorage.getItem(PRICING_KEY); if (saved) return validatePricing(JSON.parse(saved)); } catch { /* use defaults */ }
  return defaultPricing();
}
export function savePricing(value: PricingSettings): boolean {
  try { localStorage.setItem(PRICING_KEY, JSON.stringify(validatePricing(value))); return true; } catch { return false; }
}
export type Estimate = { pool: Address; quote: Address; symbol: string; decimals: number; numerator: string; denominator: string; blockHash: string; window: number; minLiquidity: string };
export type LocalCall = (to: Address, input: Hex) => Promise<Hex>;
export const oracleAbi = parseAbi([
  'function getPool(address,address,uint24) view returns (address)',
  'function factory() view returns (address)', 'function token0() view returns (address)', 'function token1() view returns (address)',
  'function fee() view returns (uint24)', 'function liquidity() view returns (uint128)',
  'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)',
  'function observe(uint32[]) view returns (int56[],uint160[])',
]);
export async function contractRead(call: LocalCall, to: Address, functionName: string, args: readonly unknown[] = []): Promise<any> {
  const data = encodeFunctionData({ abi: oracleAbi, functionName, args } as any);
  return decodeFunctionResult({ abi: oracleAbi, functionName, data: await call(to, data) } as any);
}
// Fixed-point exponentiation with 512 fractional bits, avoiding floating point and
// retaining far more precision than the v3 tick's representable price range.
const Q = 1n << 512n;
export function tickRatio(tick: number): bigint {
  if (!Number.isInteger(tick) || Math.abs(tick) > 887272) throw new Error('Invalid oracle tick.');
  let power = Math.abs(tick), base = 10001n * Q / 10000n, result = Q;
  while (power) { if (power % 2) result = result * base / Q; base = base * base / Q; power = Math.floor(power / 2); }
  return tick < 0 ? Q * Q / result : result;
}
function sqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('Negative square root.');
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) { const next = (x + n / x) / 2n; if (next >= x) return x; x = next; }
}
function delta(value: bigint, bits: number, signed = false) {
  return signed ? BigInt.asIntN(bits, value) : BigInt.asUintN(bits, value);
}
export function oracleMeans(ticks: readonly bigint[], seconds: readonly bigint[]) {
  if (ticks.length !== 2 || seconds.length !== 2) throw new Error('Invalid oracle observations.');
  const tickDelta = delta(ticks[1]! - ticks[0]!, 56, true);
  let tick = tickDelta / BigInt(WINDOW);
  if (tickDelta < 0n && tickDelta % BigInt(WINDOW)) tick--;
  const elapsed = delta(seconds[1]! - seconds[0]!, 160);
  if (!elapsed) throw new Error('Insufficient time-weighted liquidity.');
  const liquidity = (BigInt(WINDOW) * ((1n << 160n) - 1n)) / (elapsed << 32n);
  if (liquidity <= 0n || liquidity >= 1n << 128n) throw new Error('Invalid harmonic liquidity.');
  return { tick: Number(tick), liquidity };
}
type PoolQuote = { pool: Address; token0: Address; token1: Address; tick: number; liquidity: bigint; current: bigint; sqrtPrice: bigint };
export class TwapOracle {
  private pools = new Map<string, PoolQuote>();
  private selections = new Map<string, PoolQuote>();
  private put<T>(cache: Map<string, T>, key: string, value: T) { if (cache.size >= 128) cache.delete(cache.keys().next().value!); cache.set(key, value); }
  async estimate(token: Token, settings: PricingSettings, block: VerifiedBlock, call: LocalCall, progress: (message: string) => void): Promise<Estimate> {
    const base = token.address === 'eth' ? WETH : token.address;
    const quote = settings.quote.address;
    const read = (to: Address, method: string, args: readonly unknown[] = []) => contractRead(call, to, method, args);
    const decimals = settings.quote.decimals;
    const common = { quote, symbol: settings.quote.symbol, decimals, blockHash: block.hash, window: WINDOW, minLiquidity: settings.minLiquidity };
    // A holding denominated in the quote token needs no oracle conversion.
    if (base === quote) return { ...common, pool: zeroAddress, numerator: '1', denominator: '1' };
    if ((settings.minLiquidity.split('.')[1]?.length || 0) > decimals) throw new Error('Liquidity floor exceeds configured quote precision.');
    const floor = parseUnits(settings.minLiquidity, decimals);
    if (floor <= 0n) throw new Error('Invalid liquidity floor.');
    const selectionKey = [base, quote, WINDOW, block.hash, floor].join(':');
    let selected = this.selections.get(selectionKey);
    if (!selected) {
      const fixed = base === WETH && quote === USDC;
      const candidates: { result: PoolQuote; depth: bigint }[] = [];
      for (const fee of fixed ? [500] : [100, 500, 3000, 10000]) {
        progress(`Pricing ${token.symbol}: checking direct ${token.symbol}/${settings.quote.symbol} v3 pool (${fee / 10000}%) against the canonical factory.`);
        const pool = getAddress(await read(V3_FACTORY, 'getPool', [base, quote, fee]));
        if (pool === zeroAddress) continue;
        if (fixed && pool !== WETH_USDC_POOL) throw new Error('Unexpected WETH/USDC 0.05% pool.');
        const cacheKey = [pool, WINDOW, block.hash].join(':');
        let result = this.pools.get(cacheKey);
        if (!result) {
          try {
            const factory = getAddress(await read(pool, 'factory'));
            const token0 = getAddress(await read(pool, 'token0'));
            const token1 = getAddress(await read(pool, 'token1'));
            if (factory !== V3_FACTORY || Number(await read(pool, 'fee')) !== fee
              || ![token0, token1].includes(base) || ![token0, token1].includes(quote) || token0 === token1) throw new Error('Pool identity mismatch.');
            const current = BigInt(await read(pool, 'liquidity'));
            const slot = await read(pool, 'slot0');
            const sqrtPrice = BigInt(slot[0]);
            if (current <= 0n || sqrtPrice <= 0n || !slot[6]) throw new Error('Pool has no active liquidity.');
            progress(`Pricing ${token.symbol}: verifying observe([1800, 0]) and harmonic liquidity locally through the private route.`);
            // Canonical observe reverts with OLD if the full window is unavailable.
            const observations = await read(pool, 'observe', [[WINDOW, 0]]);
            const mean = oracleMeans(observations[0], observations[1]);
            result = { pool, token0, token1, tick: mean.tick, liquidity: mean.liquidity, current, sqrtPrice };
            // Cache orientation-independent liquidity, normalized below for each quote.
            this.put(this.pools, cacheKey, result);
          } catch { continue; }
        }
        const sqrtMean = sqrt(tickRatio(result.tick));
        const quoteIs1 = result.token1 === quote;
        const depth = quoteIs1 ? result.liquidity * sqrtMean / (1n << 256n) : result.liquidity * (1n << 256n) / sqrtMean;
        const currentDepth = quoteIs1 ? result.current * result.sqrtPrice / (1n << 96n) : result.current * (1n << 96n) / result.sqrtPrice;
        if (depth >= floor && currentDepth >= floor) candidates.push({ result, depth });
      }
      selected = candidates.sort((a, b) => a.depth === b.depth ? a.result.pool.localeCompare(b.result.pool) : a.depth > b.depth ? -1 : 1)[0]?.result;
      if (!selected) throw new Error('No direct pool qualifies: require 30-minute history and sufficient current/harmonic quote liquidity.');
      this.put(this.selections, selectionKey, selected);
    }
    progress(`Pricing ${token.symbol}: one direct pool selected; calculating the 30-minute TWAP locally.`);
    const ratio = tickRatio(selected.tick);
    return { ...common, pool: selected.pool, numerator: (base === selected.token0 ? ratio : Q).toString(), denominator: (base === selected.token0 ? Q : ratio).toString() };
  }
}
export type Fraction = { numerator: bigint; denominator: bigint };
export function valueFraction(amount: bigint, estimate: Estimate): Fraction {
  return { numerator: amount * BigInt(estimate.numerator), denominator: BigInt(estimate.denominator) };
}
export function addValues(a: Fraction, b: Fraction): Fraction {
  const numerator = a.numerator * b.denominator + b.numerator * a.denominator;
  const denominator = a.denominator * b.denominator;
  let x = numerator, y = denominator;
  while (y) { const remainder = x % y; x = y; y = remainder; }
  return { numerator: numerator / (x || 1n), denominator: denominator / (x || 1n) };
}
// Extra fractional precision is discarded only on the path to display formatting.
export function displayValue(value: Fraction): bigint { return value.numerator * 10n ** 18n / value.denominator; }

export function usableEstimate(balance: { amount?: bigint; verifiedBlock?: VerifiedBlock; estimate?: Estimate }, settings: PricingSettings): Estimate | undefined {
  const estimate = balance.estimate;
  return balance.amount !== undefined && estimate?.quote === settings.quote.address && estimate.decimals === settings.quote.decimals && estimate.blockHash === balance.verifiedBlock?.hash && estimate.window === WINDOW && estimate.minLiquidity === settings.minLiquidity ? estimate : undefined;
}
