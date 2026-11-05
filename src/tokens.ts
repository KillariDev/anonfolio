import { getAddress, isAddress, type Address } from 'viem';
import { WETH } from './config';

export type Token = { address: Address; symbol: string; decimals: number };
export const wethToken: Token = { address: WETH, symbol: 'WETH', decimals: 18 };
export function validateToken(address: string, symbol: string, decimals: string): Token {
  if (!isAddress(address.trim())) throw new Error('Enter a valid mainnet token contract address.');
  if (getAddress(address.trim()) === WETH) throw new Error('WETH is already tracked.');
  if (!/^[a-zA-Z0-9._-]{1,16}$/.test(symbol.trim())) {
    throw new Error('Use a token symbol with 1–16 letters, numbers, dots, underscores or hyphens.');
  }
  if (!/^\d{1,3}$/.test(decimals) || Number(decimals) > 255) {
    throw new Error('Token decimals must be a whole number from 0 to 255.');
  }
  return { address: getAddress(address.trim()), symbol: symbol.trim(), decimals: Number(decimals) };
}
export function parseWalletList(value: string): Address[] {
  const entries = value.split(/[\s,;]+/).filter(Boolean);
  if (!entries.length || entries.some(address => !isAddress(address))) {
    throw new Error('Enter a valid Ethereum address (0x followed by 40 hex characters). Separate a list with commas or new lines.');
  }
  return [...new Set(entries.map(address => getAddress(address)))];
}
