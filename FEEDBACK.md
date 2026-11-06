# Uniswap Developer Feedback — anonfolio

**Project:** [anonfolio](https://github.com/KillariDev/anonfolio)  
**Event:** ETHGlobal Mumbai 2026  
**Integration:** Uniswap v3 price oracles on Ethereum mainnet

## How the project uses Uniswap

Anonfolio uses Uniswap v3 pools to calculate portfolio price estimates directly from onchain data. It reads 30-minute time-weighted average prices from qualifying direct token/quote pools, with USDC as the default quote token. ETH and WETH use the WETH/USDC 0.05% pool.

The application checks pool identity, observation history and liquidity. Factory and pool calls execute locally through Helios against verified Ethereum state, using the same finalized block as the corresponding balances. Calculations use bigint arithmetic, and tokens without a qualifying pool remain unpriced.

## What worked well

- The factory and pool interfaces provide the information needed to discover pools, validate their identity and retrieve oracle observations.
- The `observe` function exposes both price and liquidity accumulators, supporting a price estimate alongside checks on liquidity over the observation window.
- Direct contract access fits an application that verifies blockchain data locally and routes its requests through a private transport.

## What would improve the developer experience

### 1. A complete viem and bigint oracle example

A compact example combining pool discovery across fee tiers, observation reads, mean-tick calculation and price conversion would be useful. Include token ordering, different token decimals, negative-tick rounding and insufficient-history cases.

### 2. Practical guidance on selecting suitable pools

A guide comparing current liquidity, harmonic mean liquidity and available observation history would help developers choose appropriate checks. It should explain the limitations of these checks and when an application should leave an asset unpriced.

### 3. An example using one verified block

A worked example that pins every factory and pool read to the same block would help applications produce consistent results. Showing how to integrate these calls with a browser light client or local EVM would be particularly valuable for applications combining private RPC access with proof verification.

## Relevant code

- [Pool discovery, identity checks and oracle observations](https://github.com/KillariDev/anonfolio/blob/58e9489318211fe152d7987c61a3bc64593a3dcb/src/pricing.ts#L112-L136)
- [Liquidity screening and final TWAP price conversion](https://github.com/KillariDev/anonfolio/blob/58e9489318211fe152d7987c61a3bc64593a3dcb/src/pricing.ts#L141-L159)
