export const TOR_SPECIFIER = '0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e' as const;
export const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const;
const list = (value: string | undefined, fallback: string) =>
  (value || fallback).split(',').map((s) => s.trim()).filter(Boolean);
export const config = {
  bootstrapRpc: import.meta.env.VITE_BOOTSTRAP_RPC || 'https://ethereum-rpc.publicnode.com',
  gateways: list(import.meta.env.VITE_ANON_GATEWAYS, '152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ'),
  rpcUrls: list(import.meta.env.VITE_RPC_URLS, 'https://ethereum-rpc.publicnode.com,https://eth.drpc.org,https://rpc.ankr.com/eth'),
};
for (const url of [config.bootstrapRpc, ...config.rpcUrls]) {
  if (new URL(url).protocol !== 'https:') throw new Error('RPC endpoints must use HTTPS.');
}
