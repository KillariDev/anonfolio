export type NetworkSettings = { bootstrapRpc: string; gateways: string[]; rpcUrls: string[] };
export const SETTINGS_KEY = 'anonfolio.network.v1';
export function validateSettings(value: unknown): NetworkSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid network settings.');
  const data = value as Partial<NetworkSettings>;
  function rpc(value: unknown): string {
    if (typeof value !== 'string') throw new Error('RPC endpoints must be valid HTTPS URLs.');
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) throw new Error();
      return url.href;
    } catch { throw new Error('RPC endpoints must be valid HTTPS URLs without URL credentials or fragments.'); }
  }
  function entries(value: unknown, label: string): string[] {
    if (!Array.isArray(value) || !value.length || value.some(item => typeof item !== 'string' || !item.trim())) {
      throw new Error('Enter at least one ' + label + '.');
    }
    return [...new Set((value as string[]).map(item => item.trim()))];
  }
  const gateways = entries(data.gateways, 'Tor gateway');
  for (const gateway of gateways) {
    const match = /^(\[[^\]\s]+\]|[^:\s/]+):(\d+):(u[A-Za-z0-9_-]+)$/.exec(gateway);
    try {
      if (!match || +match[2]! < 1 || +match[2]! > 65535) throw new Error();
      const hash = atob(match[3]!.slice(1).replace(/-/g, '+').replace(/_/g, '/'));
      if (hash.length !== 34 || hash.charCodeAt(0) !== 0x12 || hash.charCodeAt(1) !== 0x20) throw new Error();
    } catch { throw new Error('Use Tor gateway format ip:port:certhash (or [ipv6]:port:certhash), with a valid SHA-256 certificate hash and port 1–65535.'); }
  }
  return { bootstrapRpc: rpc(data.bootstrapRpc), gateways,
    rpcUrls: [...new Set(entries(data.rpcUrls, 'balance RPC endpoint').map(rpc))] };
}
export function loadSettings(defaults: NetworkSettings): NetworkSettings {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) return validateSettings(JSON.parse(saved));
  } catch { /* Corrupt or blocked browser storage uses deployment defaults. */ }
  return { ...defaults, gateways: [...defaults.gateways], rpcUrls: [...defaults.rpcUrls] };
}
export function saveSettings(settings: NetworkSettings | null): boolean {
  try {
    if (settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(validateSettings(settings)));
    else localStorage.removeItem(SETTINGS_KEY);
    return true;
  } catch { return false; }
}
