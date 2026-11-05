import { getAddress, isAddress, type Address } from 'viem';
import { WETH } from './config';

export type Token = { address: Address | 'eth'; symbol: string; decimals: number; icon?: string };
export const ethToken: Token = { address: 'eth', symbol: 'ETH', decimals: 18, icon: 'builtin:eth' };
export const wethToken: Token = { address: WETH, symbol: 'WETH', decimals: 18, icon: 'builtin:weth' };
export const defaultTokens = () => [{ ...ethToken }, { ...wethToken }];
export function validateIcon(icon: unknown): string | undefined {
  if (icon === undefined || icon === '') return undefined;
  if (icon === 'builtin:eth' || icon === 'builtin:weth') return icon;
  if (typeof icon !== 'string' || icon.length > 90_000
    || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(icon)) {
    throw new Error('Choose a PNG, JPEG or WebP icon saved from this browser.');
  }
  return icon;
}
export function validateToken(address: string, symbol: string, decimals: string, icon?: string): Token {
  const native = address.trim() === 'eth';
  if (!native && !isAddress(address.trim())) throw new Error('Enter a valid mainnet token contract address.');
  if (!/^[a-zA-Z0-9._-]{1,16}$/.test(symbol.trim())) {
    throw new Error('Use a token symbol with 1–16 letters, numbers, dots, underscores or hyphens.');
  }
  if (!/^\d{1,3}$/.test(decimals) || Number(decimals) > 255 || (native && Number(decimals) !== 18)) {
    throw new Error(native ? 'Native ETH uses 18 decimals.' : 'Token decimals must be a whole number from 0 to 255.');
  }
  const token: Token = { address: native ? 'eth' : getAddress(address.trim()), symbol: symbol.trim(), decimals: Number(decimals) };
  const selectedIcon = validateIcon(icon) || (native ? ethToken.icon : token.address === WETH ? wethToken.icon : undefined);
  if (selectedIcon) token.icon = selectedIcon;
  return token;
}
export function parseWalletList(value: string): Address[] {
  const entries = value.split(/[\s,;]+/).filter(Boolean);
  if (!entries.length || entries.some(address => !isAddress(address))) {
    throw new Error('Enter a valid Ethereum address (0x followed by 40 hex characters). Separate a list with commas or new lines.');
  }
  return [...new Set(entries.map(address => getAddress(address)))];
}
