import { expect, test } from 'bun:test';
import { partitionHoldings } from '../src/holdings';
import { makeWallet } from '../src/balances';
import { defaultTokens } from '../src/tokens';
const block = { hash: '0x'+'11'.repeat(32), stateRoot: '0x'+'22'.repeat(32), number:'0x100', timestamp: Date.now() };

test('only current proven zero balances are collapsed', () => {
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
    expect(partitionHoldings(wallet,tokens)).toEqual({visible:tokens,zero:[]});
  }
  wallet.eth = {amount:0n, failed:false, verifiedBlock:block};
  expect(partitionHoldings(wallet,tokens)).toEqual({visible:[tokens[1]!],zero:[tokens[0]!]});
  wallet.weth = {amount:0n, failed:false, verifiedBlock:block};
  expect(partitionHoldings(wallet,tokens)).toEqual({visible:[],zero:tokens});
});
