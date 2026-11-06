import { expect, test } from 'bun:test';
import { visibleHoldings } from '../src/holdings';
import { makeWallet } from '../src/balances';
import { defaultTokens } from '../src/tokens';
const block = { hash: '0x'+'11'.repeat(32), stateRoot: '0x'+'22'.repeat(32), number:'0x100', timestamp: Date.now() };

test('only current proven zero balances are omitted', () => {
  const wallet = makeWallet('0x0000000000000000000000000000000000000001', 'https://rpc.example');
  const tokens = defaultTokens();
  for (const balance of [
    {amount:0n, failed:false},
    {amount:0n, failed:false, cached:true, verifiedBlock:block},
    {amount:0n, failed:true, verifiedBlock:block},
    {amount:1n, failed:false, verifiedBlock:block},
    {amount:1n, failed:true, cached:true, verifiedBlock:block},
    {failed:true}, {failed:false},
  ]) {
    wallet.eth = balance;
    expect(visibleHoldings(wallet,tokens)).toEqual(tokens);
  }
  wallet.eth = {amount:0n, failed:false, verifiedBlock:block};
  expect(visibleHoldings(wallet,tokens)).toEqual([tokens[1]!]);
  wallet.weth = {amount:0n, failed:false, verifiedBlock:block};
  expect(visibleHoldings(wallet,tokens)).toEqual([]);
});
