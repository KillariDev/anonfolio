import { loadSettings } from './settings';
export const TOR_SPECIFIER = '0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e' as const;
export const TOR_WORKER_HASH = '0x5b62f358ce7a2b94ee9bc3a0e6a08757db68fa08fc348276f31eda788aec818b' as const;
export function assertTorWorkerHash(value: unknown) {
  if (typeof value !== 'string' || value.toLowerCase() !== TOR_WORKER_HASH) throw new Error('Tor worker digest differs from the reviewed pin.');
}
export const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const;
const list = (value: string | undefined, fallback: string) =>
  (value || fallback).split(',').map((s) => s.trim()).filter(Boolean);
export const defaultConfig = {
  gateways: list(import.meta.env.VITE_ANON_GATEWAYS, '152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ'),
  rpcUrls: list(import.meta.env.VITE_RPC_URLS, 'https://eth.drpc.org,https://ethereum-rpc.publicnode.com,https://rpc.ankr.com/eth'),
};
for (const url of defaultConfig.rpcUrls) {
  if (new URL(url).protocol !== 'https:') throw new Error('RPC endpoints must use HTTPS.');
}

export const config = loadSettings(defaultConfig);
