import { expect, test } from 'bun:test';
import { decodeFunctionData, encodeFunctionResult, getAddress, zeroAddress, type Address } from 'viem';
import { TwapOracle, defaultPricing, oracleAbi, V3_FACTORY, USDC, WETH_USDC_POOL, WINDOW, tickRatio, oracleMeans, valueFraction, displayValue, addValues, usableEstimate, validatePricing, type LocalCall } from '../src/pricing';
import { WETH } from '../src/config';
import { ethToken, wethToken, validateToken } from '../src/tokens';
import { makeWallet, formatBalance } from '../src/balances';
import { estimatedTotal } from '../src/totals';
import { savePortfolio, loadPortfolio } from '../src/storage';
const block = { hash: '0x' + '11'.repeat(32), stateRoot: '0x' + '22'.repeat(32), number: '0x100', timestamp: Date.now() - 60_000 };
const low = '0x0000000000000000000000000000000000000001' as Address;
const high = getAddress('0xf000000000000000000000000000000000000001');
const poolAddress = '0x0000000000000000000000000000000000000010' as Address;
type Fixture = { base?: Address; quote?: Address; tick?: number; history?: boolean; liquidity?: bigint; harmonic?: bigint; factory?: Address; noDirect?: boolean; decimals?: number; fee?: number };
function fixture(options: Fixture = {}) {
  const base = options.base ?? WETH, quote = options.quote ?? USDC;
  const [token0, token1] = [base, quote].sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const pool = base === WETH && quote === USDC ? WETH_USDC_POOL : poolAddress;
  const calls: { to: Address; method: string; args: readonly unknown[] }[] = [];
  const call: LocalCall = async (to, input) => {
    const { functionName: method, args = [] } = decodeFunctionData({ abi: oracleAbi, data: input });
    calls.push({ to, method, args });
    let result: any;
    const liquidity = options.liquidity ?? 10n ** 30n;
    const harmonic = options.harmonic ?? liquidity;
    switch (method) {
      case 'getPool':
        expect(to).toBe(V3_FACTORY);
        expect(args.slice(0,2)).toEqual([base, quote]);
        result = options.noDirect || Number(args[2]) !== (options.fee ?? 500) ? zeroAddress : pool; break;
      case 'factory': result = options.factory ?? V3_FACTORY; break;
      case 'token0': result = token0; break;
      case 'token1': result = token1; break;
      case 'fee': result = options.fee ?? 500; break;
      case 'decimals': result = options.decimals ?? 6; break;
      case 'liquidity': result = liquidity; break;
      case 'slot0': result = [1n << 96n, 0, 1, 2, 2, 0, true]; break;
      case 'observe':
        expect(args).toEqual([[WINDOW, 0]]);
        if (options.history === false) throw new Error('OLD');
        result = [[0n, BigInt(options.tick ?? 0) * BigInt(WINDOW)], [0n, BigInt(WINDOW) * (1n << 128n) / harmonic]]; break;
      default: throw new Error('Unexpected method');
    }
    return encodeFunctionResult({ abi: oracleAbi, functionName: method, result } as any);
  };
  return { call, calls, pool };
}
const progress = () => {};
test('ETH and WETH share exactly the canonical direct 0.05% pool and a block/window quote cache', async () => {
  const oracle = new TwapOracle(), rpc = fixture({ tick: 200000 });
  const eth = await oracle.estimate(ethToken, defaultPricing(), block, rpc.call, progress);
  const count = rpc.calls.length;
  const weth = await oracle.estimate(wethToken, defaultPricing(), block, rpc.call, progress);
  expect(eth).toEqual(weth); expect(rpc.calls.length).toBe(count);
  expect(eth.pool).toBe(WETH_USDC_POOL); expect(eth.blockHash).toBe(block.hash);
  expect(rpc.calls.filter(c => c.method === 'getPool').map(c => c.args[2])).toEqual([500]);
  await oracle.estimate(ethToken, defaultPricing(), { ...block, hash: '0x'+'33'.repeat(32) }, rpc.call, progress);
  expect(rpc.calls.filter(c => c.method === 'observe')).toHaveLength(2);
});
test('token ordering and verified quote decimals convert raw amounts without floating point', async () => {
  for (const address of [low, high]) {
    const token = validateToken(address, 'TEST', '18');
    const rpc = fixture({ base: address, tick: 0, decimals: 8 });
    const estimate = await new TwapOracle().estimate(token, defaultPricing(), block, rpc.call, progress);
    expect(estimate.decimals).toBe(8); // verified, not the supplied six
    expect(formatBalance(displayValue(valueFraction(123456789n, estimate)), 26)).toBe('1.23');
    const price = await new TwapOracle().estimate(token, defaultPricing(), block, fixture({ base: address, tick: 100 }).call, progress);
    const result = displayValue(valueFraction(10n ** 18n, price));
    expect(address === low ? result > 10n ** 36n : result < 10n ** 36n).toBe(true);
  }
});
test('negative fractional ticks round down and accumulator wrapping is supported', () => {
  expect(oracleMeans([0n, -1801n], [0n, 1800n * (1n << 128n) / 1000000n]).tick).toBe(-2);
  const end = 1800n * (1n << 128n) / 1000000n;
  expect(oracleMeans([0n, 0n], [(1n << 160n) - 100n, end - 100n]).liquidity).toBeGreaterThan(999999n);
  expect(tickRatio(0)).toBe(1n << 512n);
  expect(tickRatio(100)).toBeGreaterThan(tickRatio(0));
  expect(tickRatio(-100)).toBeLessThan(tickRatio(0));
  expect(() => tickRatio(887273)).toThrow();
});
test('insufficient history, current liquidity, harmonic liquidity and a forged factory remain unpriced', async () => {
  for (const options of [{ history: false }, { liquidity: 1n }, { harmonic: 1n }, { factory: low }]) {
    const rpc = fixture(options);
    await expect(new TwapOracle().estimate(ethToken, defaultPricing(), block, rpc.call, progress)).rejects.toThrow('No direct pool qualifies');
  }
});
test('a token with only a WETH pool is never routed through WETH to USDC', async () => {
  const rpc = fixture({ base: low, noDirect: true });
  await expect(new TwapOracle().estimate(validateToken(low, 'ONLYWETH', '18'), defaultPricing(), block, rpc.call, progress)).rejects.toThrow('No direct pool qualifies');
  const lookups = rpc.calls.filter(c => c.method === 'getPool');
  expect(lookups).toHaveLength(4);
  expect(lookups.every(c => c.args[1] === USDC && c.args[0] === low)).toBe(true);
  expect(rpc.calls.some(c => c.to === WETH)).toBe(false);
});
test('custom quote uses only its direct pair and same-token holdings are denominated at par', async () => {
  const settings = validatePricing({ quote: { address: low, symbol: 'CUSTOM', decimals: 8 }, minLiquidity: '100' });
  const rpc = fixture({ base: WETH, quote: low, decimals: 8 });
  const estimate = await new TwapOracle().estimate(ethToken, settings, block, rpc.call, progress);
  expect(estimate.quote).toBe(low); expect(estimate.pool).toBe(poolAddress);
  expect(rpc.calls.filter(c => c.method === 'getPool').every(c => c.args[1] === low)).toBe(true);
  const self = await new TwapOracle().estimate(settings.quote, settings, block, rpc.call, progress);
  expect(self.numerator).toBe(self.denominator); expect(self.pool).toBe(zeroAddress);
  expect(() => validatePricing({ quote: { address: 'eth', symbol: 'ETH', decimals: 18 }, minLiquidity: '1' })).toThrow();
});
test('rational values sum before display; unpriced holdings and mixed blocks are explicit', async () => {
  const settings = defaultPricing(), rpc = fixture();
  const estimate = await new TwapOracle().estimate(ethToken, settings, block, rpc.call, progress);
  const first = makeWallet(low, 'https://rpc.invalid');
  first.eth = { amount: 6000n, failed: false, verifiedBlock: block, estimate };
  first.weth = { amount: 6000n, failed: false, verifiedBlock: { ...block, hash: '0x'+'44'.repeat(32) }, estimate: { ...estimate, blockHash: '0x'+'44'.repeat(32) }, cached: true };
  const tokens = [ethToken, wethToken, validateToken(high, 'NOPOOL', '18')];
  const total = estimatedTotal([first], tokens, settings);
  expect(total.known).toBe(2); expect(total.count).toBe(3); expect(total.mixedBlocks).toBe(true); expect(total.stale).toBe(1);
  expect(formatBalance(displayValue(total.value), total.decimals+18)).toBe('0.01');
  expect(usableEstimate(first.eth, { ...settings, minLiquidity: '1' })).toBeUndefined();
  expect(usableEstimate({ ...first.eth, verifiedBlock: { ...block, hash: 'wrong' } }, settings)).toBeUndefined();
  expect(addValues({ numerator: 1n, denominator: 3n }, { numerator: 2n, denominator: 3n })).toEqual({ numerator: 1n, denominator: 1n });
});
test('verified quote estimates persist with their balance block and reload as stale', async () => {
  const storage = new Map<string,string>();
  const old = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key:string) => storage.get(key) ?? null, setItem: (key:string,value:string) => storage.set(key,value) } });
  try {
    const wallet = makeWallet(low, 'https://rpc.invalid');
    const estimate = await new TwapOracle().estimate(ethToken, defaultPricing(), block, fixture().call, progress);
    wallet.eth = { amount: 1n, updatedAt: Date.now(), verifiedBlock: block, estimate, failed: false };
    expect(savePortfolio([wallet], [ethToken])).toBe(true);
    const restored = loadPortfolio(['https://rpc.invalid']).wallets[0]!.eth;
    expect(restored.estimate).toEqual(estimate); expect(restored.cached).toBe(true);
  } finally { Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: old }); }
});

test('one deepest qualifying direct pool is selected instead of blending fee tiers', async () => {
  const shallow = fixture({ base: low, fee: 500, harmonic: 10n ** 20n });
  const deep = fixture({ base: low, fee: 3000, harmonic: 10n ** 25n });
  const deeperPool = '0x0000000000000000000000000000000000000011' as Address;
  const call: LocalCall = async (to, input) => {
    const { functionName, args } = decodeFunctionData({ abi: oracleAbi, data: input });
    if (functionName === 'getPool') return encodeFunctionResult({ abi: oracleAbi, functionName, result: Number(args![2]) === 500 ? poolAddress : Number(args![2]) === 3000 ? deeperPool : zeroAddress });
    return (to === deeperPool ? deep.call : shallow.call)(to, input);
  };
  const estimate = await new TwapOracle().estimate(validateToken(low, 'TOKEN', '18'), defaultPricing(), block, call, progress);
  expect(estimate.pool).toBe(deeperPool);
  expect(estimate.numerator).toBe(estimate.denominator); // both fake pools have tick zero
});
test('a cached pool can be quoted in reverse without mixing liquidity units', async () => {
  const oracle = new TwapOracle();
  const forward = await oracle.estimate(validateToken(low, 'TOKEN', '8'), defaultPricing(), block, fixture({ base: low, tick: 100 }).call, progress);
  const reverseSettings = validatePricing({ quote: { address: low, symbol: 'TOKEN', decimals: 8 }, minLiquidity: '100' });
  const reverseRpc = fixture({ base: USDC, quote: low, tick: 100, decimals: 8 });
  const reverse = await oracle.estimate(defaultPricing().quote, reverseSettings, block, reverseRpc.call, progress);
  expect(reverse.numerator).toBe(forward.denominator); expect(reverse.denominator).toBe(forward.numerator);
  expect(reverseRpc.calls.filter(c => c.method === 'observe')).toHaveLength(0);
});
