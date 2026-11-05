import type { Address } from 'viem';
import { parseWalletList } from './tokens';

export type TrackedAddress = { address: Address; name?: string };
export function validateAddressName(value: string): string | undefined {
  const name = value.trim();
  if (name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('Use an address name of at most 80 characters without control characters.');
  }
  return name || undefined;
}
export function parseTrackedAddresses(value: string, name = ''): TrackedAddress[] {
  const entries: TrackedAddress[] = [];
  if (value.includes('|')) {
    for (const line of value.split(/\r?\n/).filter(line => line.trim())) {
      const parts = line.split('|');
      if (parts.length === 1) entries.push(...parseWalletList(line).map(address => ({ address })));
      else {
        if (parts.length !== 2) throw new Error('Use Name | address, one named address per line.');
        const addresses = parseWalletList(parts[1]!);
        if (addresses.length !== 1) throw new Error('Use one address per named line.');
        entries.push({ address: addresses[0]!, name: validateAddressName(parts[0]!) });
      }
    }
  } else entries.push(...parseWalletList(value).map(address => ({ address })));
  const unique = [...new Map(entries.map(entry => [entry.address, entry])).values()];
  const singleName = validateAddressName(name);
  if (singleName) {
    if (unique.length !== 1) throw new Error('The name field is for one address. For a list, use Name | address on each line.');
    unique[0]!.name = singleName;
  }
  return unique;
}
