import { getAddress, isAddress, type Address } from 'viem';
const KEY = 'anonfolio.wallets.v1';
export function loadAddresses(): Address[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(data)) return [];
    return [...new Set(data.filter((s): s is string => typeof s === 'string' && isAddress(s)).map((address) => getAddress(address)))];
  } catch { return []; }
}
export function saveAddresses(addresses: Address[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(addresses)); return true; }
  catch { return false; }
}
