export function pageMarkup(appIcon: string) {
  return `
<header><a class="brand" href="./" aria-label="Anonfolio home"><img class="brand-mark" src="${appIcon}" width="28" height="28" alt="">anonfolio<span class="brand-dot">.</span></a><div class="header-statuses"><div id="connection" role="status" aria-label="Private connection"></div><div id="helios-status" role="status" aria-label="Helios light client" tabindex="0"></div></div><div class="header-actions"><span class="network"><i></i>Ethereum mainnet</span><details id="network-settings"><summary class="settings-toggle" role="button" aria-label="Settings" title="Settings" aria-controls="settings-panel"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.5"/></svg></summary>
<section id="settings-panel" class="settings-panel" aria-label="Application settings"><div class="settings-heading"><h2>Settings</h2><button id="close-settings" type="button" aria-label="Close settings" title="Close settings">×</button></div>
<details class="token-settings"><summary>Tracked tokens <span id="token-count"></span></summary>
<p class="form-hint">Choose the tokens to track across every address. Token changes save automatically.</p>
<ul id="token-list" aria-label="Tracked tokens"></ul>
<form id="token-form" novalidate>
<label for="token-preset">Token</label><select id="token-preset"><option value="custom">Custom ERC-20 token</option><option value="eth">ETH</option><option value="weth">WETH</option></select>
<div class="token-inputs">
<div><label for="token-address">Token contract address</label><input id="token-address" placeholder="0x…" autocomplete="off" spellcheck="false" aria-describedby="token-error"></div>
<div><label for="token-symbol">Symbol</label><input id="token-symbol" placeholder="USDC" maxlength="16" autocomplete="off" aria-describedby="token-error"></div>
<div><label for="token-decimals">Decimals</label><input id="token-decimals" type="number" min="0" max="255" step="1" value="18" aria-describedby="token-error"></div></div>
<label for="token-icon">Icon (optional)</label><input id="token-icon" type="file" accept="image/png,image/jpeg,image/webp"><p class="form-hint">Upload a PNG, JPEG or WebP up to 1 MB. Icons are stored in this browser.</p>
<p class="form-hint">Use the token's actual symbol and decimals (for example, USDC uses 6). You supply these display settings; balanceOf is executed locally against proven code and storage, with no approvals or transactions.</p>
<button type="submit">Add token</button><p id="token-error" class="input-error" role="alert"></p></form></details>
<form id="pricing-form" novalidate>
<h2>Price estimates</h2>
<label for="pricing-preset">Quote token</label><select id="pricing-preset"><option value="usdc">USDC (Ethereum mainnet)</option><option value="custom">Custom ERC-20</option></select>
<div id="pricing-custom"><label for="pricing-address">Quote contract address</label><input id="pricing-address" spellcheck="false" autocomplete="off"><label for="pricing-symbol">Quote symbol</label><input id="pricing-symbol" maxlength="16" autocomplete="off"><label for="pricing-decimals">Quote decimals</label><input id="pricing-decimals" type="number" min="0" max="255"></div>
<label for="pricing-liquidity">Minimum quote-side liquidity</label><input id="pricing-liquidity" inputmode="decimal" autocomplete="off">
<p class="form-hint">30-minute Uniswap v3 TWAP from one direct token/quote pool. No multihop. Both current and harmonic virtual quote reserves must meet this amount (default 10,000 USDC). Quote decimals use your configuration. No qualifying pool means no estimate.</p>
<button type="submit">Save pricing and refresh</button><p id="pricing-error" class="input-error" role="alert"></p></form>
<form id="settings-form" novalidate>
<h2>Network connection</h2>
<label for="settings-mode">Connection mode</label><select id="settings-mode"><option value="tor">Tor via Anon-RPC (default)</option><option value="https">Direct HTTPS (not anonymous)</option></select>
<p id="mode-hint" class="form-hint">Tor hides your IP from RPC providers. Direct HTTPS sends requests from your browser: providers see your IP and requested addresses. Proof verification remains enabled. There is no automatic switch between modes.</p>
<details id="tor-routing" class="advanced-settings" data-tor-only><summary>Tor routing</summary><div class="advanced-body">
<label for="settings-gateways">Tor gateways</label><textarea id="settings-gateways" rows="2" spellcheck="false" autocomplete="off" aria-describedby="gateway-hint settings-error"></textarea>
<p id="gateway-hint" class="form-hint">One ip:port:certhash entry per line. IPv6 addresses use [ipv6]:port:certhash. The default is a development demo gateway.</p>
<label for="settings-bootstrap-url">Tor directory mirror URL (optional)</label><input id="settings-bootstrap-url" spellcheck="false" autocomplete="off" placeholder="./tor-bootstrap.json"><p class="form-hint">A fresh public directory snapshot can speed up Tor startup. A missing mirror falls back to the gateways.</p>
</div></details>
<label for="settings-rpcs">Balance RPC endpoints</label><textarea id="settings-rpcs" rows="3" spellcheck="false" autocomplete="off" aria-describedby="rpc-hint settings-error"></textarea>
<p id="rpc-hint" class="form-hint">Ethereum mainnet HTTPS URLs, one per line. Addresses start on separate endpoints where possible. If an endpoint cannot serve finalized-block proofs, another configured endpoint is tried with the same private isolation key. Requests use your selected mode. Defaults include dRPC and PublicNode; no API key is required for their public endpoints.</p>
<p class="form-hint">The Tor worker is bundled and hash-verified locally. Startup never queries an Ethereum RPC. In Tor mode, consensus, balance and oracle requests all use Anon-RPC. In HTTPS mode, they go directly to the configured services.</p>
<details id="worker-settings" class="advanced-settings" data-tor-only><summary>Tor worker updates</summary><div class="advanced-body">
<label for="settings-tor-worker">Tor worker source</label><select id="settings-tor-worker"><option value="bundled">Bundled release worker (default)</option><option value="updated">Saved worker from PublicNode</option></select>
<p class="form-hint">Update only when you choose: this queries ethereum-rpc.publicnode.com directly for the Tor specifier's hash and download locations, then downloads the worker directly. No tracked addresses are sent. Applying the update trusts PublicNode's worker hash and code. Balance, proof and consensus requests use the selected connection mode.</p>
<button id="update-tor-worker" type="button">Update Tor worker from PublicNode</button>
<p id="tor-worker-status" role="status" class="form-hint"></p><pre id="tor-worker-metadata" class="form-hint" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>
</div></details>
<details id="checkpoint-settings" class="advanced-settings"><summary>Consensus checkpoint</summary><div class="advanced-body">
<label for="settings-checkpoint-root">Mainnet checkpoint root</label><input id="settings-checkpoint-root" type="text" spellcheck="false" autocomplete="off" aria-describedby="checkpoint-hint settings-error">
<label for="settings-checkpoint-slot">Checkpoint beacon slot</label><input id="settings-checkpoint-slot" type="number" min="1" step="1" aria-describedby="checkpoint-hint settings-error">
<p id="checkpoint-hint" class="form-hint">A trusted finalized beacon block root and its matching slot, less than 14 days old. Compare them across independent trusted mainnet sources before saving: this checkpoint is the light client's trust anchor. Saving restarts verification. Restore defaults uses the release-pinned checkpoint.</p>
</div></details>
<p class="form-hint">Settings are saved in this browser, including any API keys in endpoint URLs. Applying settings reloads the page and reconnects; use an address’s Refresh button to update saved balances.</p>
<div class="settings-actions"><button class="primary" type="submit">Save settings and reconnect</button><button id="reset-settings" type="button">Restore defaults</button></div>
<p id="settings-error" class="input-error" role="alert"></p></form></section></details></div></header>
<main>
<div class="page-heading"><h1>Portfolio</h1></div>
<section class="overview" aria-label="Portfolio token totals">
<div id="estimated-total" class="portfolio-value" aria-label="Estimated portfolio value" aria-live="polite"></div>
<div id="totals" class="totals" aria-live="polite"></div></section>
<p id="offline-notice" role="status"></p><p id="storage-warning" role="status"></p>
<div class="section-heading"><h2>Addresses <span id="count">0</span></h2></div>
<section id="wallets" aria-label="Watched wallets"></section>
<div class="controls">
<details id="address-panel" class="address-settings"><summary class="address-toggle" role="button" aria-label="Add addresses" title="Add addresses" aria-controls="wallet-form"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></summary>
<form id="wallet-form" novalidate>
<label for="address-name">Address name (optional, for one address)</label><input id="address-name" maxlength="80" autocomplete="off" placeholder="e.g. Savings" aria-describedby="input-error">
<label for="address">Ethereum wallet addresses</label>
<div class="input-row"><textarea id="address" name="address" rows="2" placeholder="0x… Paste one address or a list" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="wallet-hint input-error" required></textarea><button class="primary" type="submit">add address to track <span aria-hidden="true">↗</span></button></div>
<p class="form-hint" id="wallet-hint">One address per line, or separate addresses with commas. To name a list, use Name | 0x… on each line. Names are saved only in this browser.</p>
<p id="input-error" class="input-error" role="alert"></p><p id="wallet-notice" class="form-hint" role="status"></p></form></details>

</div>
</main>`;
}
