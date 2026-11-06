import { formatUnits } from 'viem';

function group(value: string): string {
  const [whole, fraction] = value.split('.');
  return whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? '.' + fraction : '');
}
// Keep all arithmetic in bigint, including carry when rounding to two places.
export function formatBalance(amount: bigint, decimals = 18): string {
  if (amount < 0n) return '-' + formatBalance(-amount, decimals);
  if (decimals <= 2) return group(formatUnits(amount, decimals));
  const divisor = 10n ** BigInt(decimals - 2);
  if (amount > 0n && amount < divisor) return '<0.01';
  return group(formatUnits((amount + divisor / 2n) / divisor, 2));
}
export function exactBalance(amount: bigint, decimals = 18): string {
  return group(formatUnits(amount, decimals));
}
