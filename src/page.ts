const docs = './docs/documentation.html';
function learnMore(anchor: string) {
  return ` <a class="learn-more" href="${docs}#${anchor}" target="_blank" rel="noopener">Learn more</a>`;
}
export function pageMarkup(appIcon: string) {
  return `
<header><a class="brand" href="./" aria-label="Anonfolio home"><img class="brand-mark" src="${appIcon}" width="28" height="28" alt="">anonfolio<span class="brand-dot">.</span></a><div class="header-statuses"><div id="connection" role="status" aria-label="Private connection"></div><div id="helios-status" role="status" aria-label="Helios light client" tabindex="0"></div></div><div class="header-actions"><span class="network"><i></i><span class="network-label">Ethereum mainnet</span></span><button id="theme-toggle" type="button" class="theme-toggle" aria-label="Switch to light theme" title="Switch to light theme"><svg class="theme-sun" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="theme-moon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg></button><details id="network-settings"><summary class="settings-toggle" role="button" aria-label="Settings" title="Settings" aria-controls="settings-panel"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.5"/></svg></summary>
<section id="settings-panel" class="settings-panel" aria-label="Application settings"><div class="settings-heading"><h2>Settings</h2><button id="close-settings" type="button" aria-label="Close settings" title="Close settings">×</button></div>
<nav class="settings-nav" aria-label="Settings sections"><button type="button" data-section="token-settings">Tokens</button><button type="button" data-section="pricing-form">Pricing</button><button type="button" data-section="settings-form">Connection</button><button type="button" data-section="advanced-settings">Advanced</button></nav>
<div class="settings-body">
<details id="token-settings" class="token-settings settings-section" open><summary>Tracked tokens <span id="token-count"></span></summary>
<p class="form-hint">Tokens are tracked across every address and save automatically.</p>
<ul id="token-list" aria-label="Tracked tokens"></ul>
<form id="token-form" novalidate>
<label for="token-preset">Token</label><select id="token-preset"><option value="custom">Custom ERC-20 token</option><option value="eth">ETH</option><option value="weth">WETH</option></select>
<div class="token-inputs">
<div><label for="token-address">Token contract address</label><input id="token-address" placeholder="0x…" autocomplete="off" spellcheck="false" aria-describedby="token-error"></div>
<div><label for="token-symbol">Symbol</label><input id="token-symbol" placeholder="USDC" maxlength="16" autocomplete="off" aria-describedby="token-error"></div>
<div><label for="token-decimals">Decimals</label><input id="token-decimals" type="number" min="0" max="255" step="1" value="18" aria-describedby="token-error"></div></div>
<label for="token-icon">Icon (optional)</label><input id="token-icon" type="file" accept="image/png,image/jpeg,image/webp"><p class="form-hint">PNG, JPEG or WebP up to 1 MB, stored in this browser.</p>
<p class="form-hint">Use the token's real symbol and decimals (USDC uses 6). balanceOf runs locally against proven code and storage; nothing is approved or sent.${learnMore('erc-20-balances-and-decimals')}</p>
<button type="submit">Add token</button><p id="token-error" class="input-error" role="alert"></p></form></details>
<form id="pricing-form" class="settings-section" novalidate>
<h2>Price estimates</h2>
<label for="pricing-preset">Quote token</label><select id="pricing-preset"><option value="usdc">USDC (Ethereum mainnet)</option><option value="custom">Custom ERC-20</option></select>
<div id="pricing-custom"><label for="pricing-address">Quote contract address</label><input id="pricing-address" spellcheck="false" autocomplete="off"><label for="pricing-symbol">Quote symbol</label><input id="pricing-symbol" maxlength="16" autocomplete="off"><label for="pricing-decimals">Quote decimals</label><input id="pricing-decimals" type="number" min="0" max="255"></div>
<label for="pricing-liquidity">Minimum quote-side liquidity</label><input id="pricing-liquidity" inputmode="decimal" autocomplete="off">
<p class="form-hint">30-minute Uniswap v3 TWAP from one direct token/quote pool whose current and harmonic quote reserves meet this amount (default 10,000 USDC). No qualifying pool means no estimate.${learnMore('direct-pool-twap-estimates')}</p>
<button type="submit">Save pricing and refresh</button><p id="pricing-error" class="input-error" role="alert"></p></form>
<form id="settings-form" class="settings-section" novalidate>
<h2>Network connection</h2>
<label for="settings-mode">Connection mode</label><select id="settings-mode"><option value="tor">Tor via Anon-RPC (default)</option><option value="https">Direct HTTPS (not anonymous)</option></select>
<p id="mode-hint" class="form-hint">Tor hides your IP from RPC providers. Direct HTTPS sends requests from your browser, so providers see your IP and the addresses you track. Proofs are verified either way, and the mode never switches on its own.${learnMore('connection-modes-and-execution-transport')}</p>
<label for="settings-rpcs">Balance RPC endpoints</label><textarea id="settings-rpcs" rows="3" spellcheck="false" autocomplete="off" aria-describedby="rpc-hint settings-error"></textarea>
<p id="rpc-hint" class="form-hint">Ethereum mainnet HTTPS URLs, one per line. Addresses start on separate endpoints; an endpoint without finalized-block proofs is skipped for another with the same isolation key. Defaults are dRPC and PublicNode without API keys.</p>
<h3 id="advanced-settings" class="settings-group">Advanced</h3>
<details id="tor-routing" class="advanced-settings" data-tor-only><summary>Tor routing</summary><div class="advanced-body">
<label for="settings-gateways">Tor gateways</label><textarea id="settings-gateways" rows="2" spellcheck="false" autocomplete="off" aria-describedby="gateway-hint settings-error"></textarea>
<p id="gateway-hint" class="form-hint">One ip:port:certhash per line, or [ipv6]:port:certhash. The default is a development demo gateway.</p>
<label for="settings-bootstrap-url">Tor directory mirror URL (optional)</label><input id="settings-bootstrap-url" spellcheck="false" autocomplete="off" placeholder="./tor-bootstrap.json"><p class="form-hint">A fresh directory snapshot speeds up Tor startup. A missing mirror falls back to the gateways.${learnMore('tor-startup-and-directory-mirrors')}</p>
</div></details>
<details id="worker-settings" class="advanced-settings" data-tor-only><summary>Tor worker updates</summary><div class="advanced-body">
<label for="settings-tor-worker">Tor worker source</label><select id="settings-tor-worker"><option value="bundled">Bundled release worker (default)</option><option value="updated">Saved worker from PublicNode</option></select>
<p class="form-hint">The bundled worker is hash-verified locally and startup never queries an Ethereum RPC. Updating queries ethereum-rpc.publicnode.com directly for the worker hash and download locations; no tracked addresses are sent, and applying it trusts PublicNode's worker code.${learnMore('pinned-tor-worker')}</p>
<button id="update-tor-worker" type="button">Update Tor worker from PublicNode</button>
<p id="tor-worker-status" role="status" class="form-hint"></p><pre id="tor-worker-metadata" class="form-hint" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>
</div></details>
<details id="checkpoint-settings" class="advanced-settings"><summary>Consensus checkpoint</summary><div class="advanced-body">
<label for="settings-checkpoint-root">Mainnet checkpoint root</label><input id="settings-checkpoint-root" type="text" spellcheck="false" autocomplete="off" aria-describedby="checkpoint-hint settings-error">
<label for="settings-checkpoint-slot">Checkpoint beacon slot</label><input id="settings-checkpoint-slot" type="number" min="1" step="1" aria-describedby="checkpoint-hint settings-error">
<p id="checkpoint-hint" class="form-hint">A trusted finalized beacon block root and its slot, under 14 days old. Compare them across independent sources before saving: this is the light client's trust anchor. Restore defaults uses the release-pinned checkpoint.${learnMore('establishing-a-trusted-finalized-block')}</p>
</div></details>
<p class="form-hint">Settings are saved in this browser, including any API keys in endpoint URLs. Saving reloads the page and reconnects.</p>
<div class="settings-actions"><button class="primary" type="submit">Save settings and reconnect</button><button id="reset-settings" type="button">Restore defaults</button></div>
<p id="settings-error" class="input-error" role="alert"></p></form></div></section></details></div></header>
<main>
<div class="page-heading"><h1>Portfolio</h1></div>
<section class="overview" aria-label="Portfolio token totals">
<div id="estimated-total" class="portfolio-value" aria-label="Estimated portfolio value" aria-live="polite"></div>
<div id="totals" class="totals" aria-live="polite"></div></section>
<p id="offline-notice" role="status"></p><p id="storage-warning" role="status"></p>
<div class="section-heading"><h2>Addresses <span id="count">0</span></h2>
<details id="address-panel" class="address-settings"><summary class="address-toggle" role="button" aria-label="Add addresses" title="Add addresses" aria-controls="wallet-form"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span class="address-toggle-label">Add address</span></summary>
<form id="wallet-form" novalidate>
<div class="wallet-form-fields">
<div class="wallet-form-name"><label for="address-name">Address name (optional, for one address)</label><input id="address-name" maxlength="80" autocomplete="off" placeholder="e.g. Savings" aria-describedby="input-error"></div>
<div class="wallet-form-addresses"><label for="address">Ethereum wallet addresses</label>
<textarea id="address" name="address" rows="2" placeholder="0x… Paste one address or a list" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="wallet-hint input-error" required></textarea></div></div>
<p class="form-hint" id="wallet-hint">One address per line, or separated by commas. To name a list, use Name | 0x… on each line. Names stay in this browser.</p>
<div class="wallet-form-actions"><button class="primary" type="submit">add address to track <span aria-hidden="true">↗</span></button></div>
<p id="input-error" class="input-error" role="alert"></p><p id="wallet-notice" class="form-hint" role="status"></p></form></details></div>
<section id="wallets" aria-label="Watched wallets"></section>
</main>`;
}
