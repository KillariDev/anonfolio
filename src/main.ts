import { captureViewport, restoreViewport } from './viewport';
import { updateChildren } from './dom';
import { appendRetrievalLog } from './retrieval-log';
import { logStream } from './log-stream';
import { readHistory } from './read-history';
import { stageLabels, progressTime, type VerificationStage } from './verification/progress';
import chevronDown from './assets/chevron-down.svg?raw';
import { discoverTorWorker, cacheTorWorker } from './worker-update';
import type { WorkerMetadata } from './worker-metadata';
import { DEFAULT_CHECKPOINT, checkCheckpointAge } from './verification/trust';
import appIcon from './assets/anonfolio.svg?no-inline';
import { addressDisplay } from './address-display';
import { parseTrackedAddresses } from './addresses';
import { config, defaultConfig } from './config';
import { saveSettings, validateSettings, type NetworkSettings } from './settings';
import { errorMessage, explainFailure, failureEndpoint, readFailure, type ReadFailure } from './errors';
import { Connection, type ConnectionState } from './connection';
import { formatBalance, makeWallet, prepareActivity, readBalances, tokenBalance, setTokenBalance, type Balance, type Wallet } from './balances';
import { loadPortfolio, savePortfolio } from './storage';
import { validateToken, defaultTokens, type Token } from './tokens';
import { RetryQueue, retryDelay } from './retries';
import { loadPricing, savePricing, validatePricing, defaultPricing, usableEstimate, valueFraction, displayValue } from './pricing';
import { estimatedTotal, portfolioTotals } from './totals';
import { readIcon, tokenIcon, statusIcon, type StatusIcon } from './icons';
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<header><a class="brand" href="./" aria-label="Anonfolio home"><img class="brand-mark" src="${appIcon}" width="28" height="28" alt="">anonfolio<span class="brand-dot">.</span></a><div id="connection" role="status" aria-label="Private connection"></div><div class="header-actions"><span class="network"><i></i>Ethereum mainnet</span><details id="network-settings"><summary class="settings-toggle" role="button" aria-label="Settings" title="Settings" aria-controls="settings-panel"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.5"/></svg></summary>
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
<label for="settings-gateways">Tor gateways</label><textarea id="settings-gateways" rows="2" spellcheck="false" autocomplete="off" aria-describedby="gateway-hint settings-error"></textarea>
<p id="gateway-hint" class="form-hint">One ip:port:certhash entry per line. IPv6 addresses use [ipv6]:port:certhash. The default is a development demo gateway.</p>
<label for="settings-rpcs">Balance RPC endpoints</label><textarea id="settings-rpcs" rows="3" spellcheck="false" autocomplete="off" aria-describedby="rpc-hint settings-error"></textarea>
<p id="rpc-hint" class="form-hint">Ethereum mainnet HTTPS URLs, one per line. Addresses start on separate endpoints where possible. If an endpoint cannot serve finalized-block proofs, another configured endpoint is tried with the same private isolation key. Every request goes through Anon-RPC.</p>
<p class="form-hint">The Tor worker is bundled and hash-verified locally. Startup never queries an Ethereum RPC. Consensus, balance and oracle requests all use Anon-RPC.</p>
<h2>Tor worker</h2>
<label for="settings-tor-worker">Tor worker source</label><select id="settings-tor-worker"><option value="bundled">Bundled release worker (default)</option><option value="updated">Saved worker from PublicNode</option></select>
<p class="form-hint">Update only when you choose: this queries ethereum-rpc.publicnode.com directly for the Tor specifier's hash and download locations, then downloads the worker directly. No tracked addresses are sent. Applying the update trusts PublicNode's worker hash and code. Balance, proof and consensus requests stay on Anon-RPC.</p>
<button id="update-tor-worker" type="button">Update Tor worker from PublicNode</button>
<p id="tor-worker-status" role="status" class="form-hint"></p><pre id="tor-worker-metadata" class="form-hint" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>
<h2 id="checkpoint-settings">Consensus checkpoint</h2>
<label for="settings-checkpoint-root">Mainnet checkpoint root</label><input id="settings-checkpoint-root" type="text" spellcheck="false" autocomplete="off" aria-describedby="checkpoint-hint settings-error">
<label for="settings-checkpoint-slot">Checkpoint beacon slot</label><input id="settings-checkpoint-slot" type="number" min="1" step="1" aria-describedby="checkpoint-hint settings-error">
<p id="checkpoint-hint" class="form-hint">A trusted finalized beacon block root and its matching slot, less than 14 days old. Compare them across independent trusted mainnet sources before saving: this checkpoint is the light client's trust anchor. Saving restarts verification. Restore defaults uses the release-pinned checkpoint.</p>
<p class="form-hint">Settings are saved in this browser, including any API keys in endpoint URLs. Applying settings reloads the page and restarts private reads; saved balances remain visible.</p>
<div class="settings-actions"><button class="primary" type="submit">Save settings and reconnect</button><button id="reset-settings" type="button">Restore defaults</button></div>
<p id="settings-error" class="input-error" role="alert"></p></form></section></details></div></header>
<main>
<div class="page-heading"><h1>Portfolio</h1></div>
<section class="overview" aria-label="Portfolio token totals">
<div id="estimated-total" class="portfolio-value" aria-label="Estimated portfolio value" aria-live="polite"></div>
<div id="totals" class="totals" aria-live="polite"></div></section>
<p id="offline-notice" role="status"></p><p id="storage-warning" role="status"></p>
<div class="section-heading"><h2>Addresses <span id="count">0</span></h2></div>
<p class="scroll-hint">Swipe the table to see more tokens and controls.</p>
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

let state: ConnectionState = 'starting';
let connectionMessage = 'Preparing the bundled Tor worker. Ethereum requests wait for the private connection.';
const { wallets, tokens } = loadPortfolio(config.rpcUrls);
let pricing = loadPricing();
const walletList = document.querySelector<HTMLElement>('#wallets')!;
walletList.tabIndex = 0;
const addressPanel = document.querySelector<HTMLDetailsElement>('#address-panel')!;
addressPanel.open = wallets.length === 0;
const addressToggle = addressPanel.querySelector<HTMLElement>('summary')!;
function syncAddressToggle() {
  addressToggle.setAttribute('aria-expanded', String(addressPanel.open));
  addressToggle.title = addressPanel.open ? 'Close address form' : 'Add addresses';
}
addressPanel.addEventListener('toggle', syncAddressToggle);
syncAddressToggle();
const settingsPanel = document.querySelector<HTMLDetailsElement>('#network-settings')!;
const settingsToggle = settingsPanel.querySelector<HTMLElement>('summary')!;
function closeSettings(restoreFocus = false) {
  settingsPanel.open = false;
  if (restoreFocus) settingsToggle.focus();
}
document.querySelector('#close-settings')!.addEventListener('click', () => closeSettings(true));
settingsPanel.addEventListener('toggle', () => settingsToggle.setAttribute('aria-expanded', String(settingsPanel.open)));
document.addEventListener('pointerdown', event => {
  if (settingsPanel.open && !settingsPanel.contains(event.target as Node)) closeSettings();
});
document.addEventListener('focusin', event => {
  if (settingsPanel.open && !settingsPanel.contains(event.target as Node)) closeSettings();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && settingsPanel.open) { event.preventDefault(); closeSettings(true); }
});
const expandedAddresses = new Set<string>();
const input = document.querySelector<HTMLTextAreaElement>('#address')!;
const error = document.querySelector<HTMLElement>('#input-error')!;
addressToggle.addEventListener('click', () => {
  if (!addressPanel.open) requestAnimationFrame(() => { if (addressPanel.open) input.focus(); });
});
const loggedRetries = new Map<Wallet,string>();
const retries = new RetryQueue<Wallet | 'connection'>(
  key => key === 'connection' ? start(true) : refreshWallet(key, true),
  () => navigator.onLine,
  () => {
    for (const wallet of wallets) {
      const connectionRetry=state==='failed'?retryMessage('connection'):'';
      const message=[retryMessage(wallet),connectionRetry?'Private connection: '+connectionRetry:''].filter(Boolean).join(' ');
      if(message && loggedRetries.get(wallet)!==message) appendRetrievalLog(wallet,message);
      loggedRetries.set(wallet,message);
    }
    for(const wallet of loggedRetries.keys()) if(!wallets.includes(wallet)) loggedRetries.delete(wallet);
    renderConnection(); render();
  },
  undefined,
  (attempt, key) => key === 'connection' ? Math.min(retryDelay(attempt), 10_000) : retryDelay(attempt),
);
const connection = new Connection(
  next => {
    state = next;
    for(const wallet of wallets) if(wallet.loading) appendRetrievalLog(wallet,'Private connection: '+next,next==='failed'?'error':'info');
    if (next === 'failed') retries.schedule('connection');
    else if (next === 'ready') retries.cancel('connection');
    renderConnection();
  },
  message => { connectionMessage = message; for(const wallet of wallets) if(wallet.loading) appendRetrievalLog(wallet,message); renderConnection(); if(wallets.some(wallet=>wallet.loading)) render(); },
);
function persist() {
  document.querySelector('#storage-warning')!.textContent = savePortfolio(wallets, tokens)
    ? '' : 'Browser storage is unavailable or full. Changes and new balances are visible now but could not be saved.';
}
function spinner() {
  const node = document.createElement('span');
  node.className = 'spinner';
  node.setAttribute('aria-hidden', 'true');
  return node;
}
function retryMessage(key: Wallet | 'connection') {
  const retry = retries.info(key);
  if (!retry) return '';
  return retry.dueAt
    ? 'Automatic retry ' + retry.attempt + ' scheduled at ' + new Date(retry.dueAt).toLocaleTimeString() + '.'
    : 'Automatic retry paused until the connection returns.';
}
function renderConnection() {
  const node = document.querySelector<HTMLElement>('#connection')!;
  node.className = 'connection ' + state;
  const heading = document.createElement('div');
  heading.className = 'connection-heading';
  if (state === 'starting') heading.append(spinner());
  const title = document.createElement('strong');
  title.textContent = state === 'ready' ? 'Private worker ready'
    : state === 'starting' ? 'Starting private connection…'
    : 'Private connection unavailable';
  heading.append(title);
  if (state === 'failed') title.title = [connection.lastError, retryMessage('connection')].filter(Boolean).join(' · ');
  if (state === 'failed') {
    const button = document.createElement('button');
    button.textContent = 'Retry connection';
    button.onclick = event => { event.preventDefault(); event.stopPropagation(); void start(); };
    heading.append(button);
  }
  updateChildren(node, [heading]);
}
function failureReport(label: string, failure: ReadFailure, rpcHost?: string, identity = label) {
  const report = document.createElement('section'); report.className = 'read-failure';
  report.setAttribute('aria-label', label + ' failure');
  report.dataset.viewKey = identity;
  const { summary, action } = explainFailure(failure);
  const header = document.createElement('div'); header.className = 'failure-heading';
  const asset = document.createElement('span'); asset.className = 'failure-label'; asset.textContent = label;
  const heading = document.createElement('strong'); heading.textContent = summary;
  header.append(asset, heading);
  const help = document.createElement('p'); help.className = 'failure-action'; help.textContent = action;
  report.append(header, help);
  const metadata = document.createElement('dl'); metadata.className = 'failure-metadata';
  const endpoint = failureEndpoint(failure, rpcHost);
  if (endpoint) {
    const entry = document.createElement('div');
    const name = document.createElement('dt'); name.textContent = endpoint.label;
    const value = document.createElement('dd'); value.textContent = endpoint.host;
    entry.append(name, value); metadata.append(entry);
  }
  if (failure.at) {
    const entry = document.createElement('div');
    const name = document.createElement('dt'); name.textContent = 'Last attempt';
    const value = document.createElement('dd');
    const date = new Date(failure.at);
    const time = document.createElement('time'); time.dateTime = date.toISOString(); time.title = date.toLocaleString();
    time.textContent = date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    value.append(time); entry.append(name, value); metadata.append(entry);
  }
  if (metadata.childElementCount) report.append(metadata);
  const technical = document.createElement('details'); technical.className = 'failure-technical';
  const toggle = document.createElement('summary'); toggle.textContent = 'Technical details';
  const message = document.createElement('p'); message.className = 'failure-message'; message.textContent = failure.message;
  technical.append(toggle, message);
  const stageText = failure.stage && errorMessage(failure.stage.replace(/^Verification transport rejected a request:\s*/i, ''));
  if (stageText && !stageText.includes(failure.message) && !failure.message.includes(stageText)) {
    const stage = document.createElement('p'); stage.className = 'failure-stage'; stage.textContent = 'Step: ' + stageText;
    technical.append(stage);
  }
  report.append(technical);
  return report;
}
function balanceFailure(balance: Balance): ReadFailure | undefined {
  return balance.failed ? balance.failure || { message: 'No error details were saved for the previous failure. Refresh this address to capture a new error.', at: 0 } : undefined;
}
function balanceNode(wallet: Wallet, symbol: string, decimals: number, balance: Balance, pending: boolean, asset: string) {
  const box = document.createElement('td');
  box.className = 'balance';
  box.dataset.asset = asset;
  const label = document.createElement('div');
  label.className = 'token';
  label.textContent = symbol;

  const amount = document.createElement('div');
  amount.className = 'amount';
  amount.textContent = balance.amount === undefined ? '—' : formatBalance(balance.amount, decimals);
  amount.title = amount.textContent;
  if (pending) amount.prepend(spinner());
  const status = document.createElement('small');
  status.className = balance.failed ? 'error' : balance.cached ? 'cached' : balance.verifiedBlock ? 'proven' : '';
  status.textContent = balance.failed ? (balance.amount === undefined ? 'Unavailable · verification failed' : 'Stale · refresh failed')
    : balance.cached ? (balance.verifiedBlock ? '' : 'Unverified saved value · reverify required') : balance.updatedAt ? (balance.verifiedBlock ? 'Verified finalized' + (balance.amount === 0n ? ' · proven zero' : '') : 'Unverified · reverify required') : 'Awaiting first read';
  if (balance.amount !== undefined && !balance.verifiedBlock) status.textContent = 'Unverified saved value · ' + (balance.failed ? 'verification failed' : 'reverify required');
  const statusText = status.textContent || (balance.cached ? 'Saved verified balance' : 'Awaiting first read');
  const statusKind: StatusIcon = balance.failed ? (balance.amount === undefined ? 'unavailable' : 'stale') : balance.cached ? (balance.verifiedBlock ? 'saved' : 'unverified') : balance.verifiedBlock ? 'verified' : balance.amount !== undefined ? 'unverified' : 'waiting';
  status.replaceChildren(statusIcon(statusKind, statusText, balance.cached && balance.verifiedBlock && !balance.failed ? 'Saved verified balance; refresh to check for updates.' : statusText));
  const statusLine = document.createElement('div'); statusLine.className = 'balance-status';
  statusLine.append(status);
  box.append(label);
  const failure = balanceFailure(balance);
  if (failure) {
    const explain = document.createElement('button'); explain.type = 'button'; explain.className = 'failure-link';
    const meaning = explainFailure(failure).summary + ' · Details';
    const icon = statusIcon(statusKind, meaning, statusText + ' · ' + meaning + ': ' + failure.message);
    icon.removeAttribute('tabindex');
    explain.append(icon);
    explain.title = failure.message;
    explain.setAttribute('aria-label', 'Explain ' + symbol + ' failure for ' + wallet.address);
    explain.setAttribute('aria-description', statusText);
    explain.onclick = () => {
      expandedAddresses.add(wallet.address); render();
      const details = document.getElementById('details-' + wallet.address)!;
      details.querySelector<HTMLDetailsElement>('.failure-details')!.open = true;
      const report = [...details.querySelectorAll<HTMLElement>('.read-failure')].find(node => node.dataset.viewKey === asset + ':balance');
      (report || details.querySelector('.failure-details')!).scrollIntoView({ block: 'nearest' });
    };
    status.replaceChildren(explain);
  }
  const estimate = usableEstimate(balance, pricing);
  const price = document.createElement('small'); price.className = 'price-estimate';
  price.textContent = estimate ? '≈ ' + formatBalance(displayValue(valueFraction(balance.amount!, estimate)), estimate.decimals + 18) + ' ' + pricing.quote.symbol + (balance.cached || balance.failed ? ' · stale' : '') : 'Unpriced';
  price.title = estimate ? '30-minute direct-pool TWAP · ' + estimate.pool + ' · finalized block ' + estimate.blockHash : balance.priceError || 'Waiting for a qualifying direct pool at the balance’s verified block.';
  if (!estimate) price.replaceChildren(statusIcon('unpriced', 'Unpriced', 'Unpriced: ' + price.title));
  else if (balance.cached || balance.failed) {
    price.textContent = price.textContent!.replace(/ · stale$/, '');
    price.title += ' · Saved price estimate; it may be out of date.';
  }
  if (estimate) {
    const text = [...price.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
    if (text) { const value = document.createElement('span'); value.className = 'price-value'; value.textContent = text.textContent; text.replaceWith(value); }
    price.title = price.textContent + ' · ' + price.title;
  }
  const values = document.createElement('div'); values.className = 'balance-values';
  values.append(amount, price, statusLine); box.append(values);
  if (balance.verifiedBlock) box.title = 'Finalized block ' + BigInt(balance.verifiedBlock.number) + ' · ' + balance.verifiedBlock.hash + ' · ' + new Date(balance.verifiedBlock.timestamp).toLocaleString();
  if (balance.updatedAt) {
    const time = document.createElement('time');
    time.className = 'sr-only';
    time.dateTime = new Date(balance.updatedAt).toISOString();
    time.textContent = new Date(balance.updatedAt).toLocaleString();
    amount.title = symbol + ': ' + amount.textContent + ' · last successful read ' + time.textContent;
    box.append(time);
  }
  return box;
}
function renderTokens() {
  const list = document.querySelector('#token-list')!;
  list.replaceChildren();
  document.querySelector('#token-count')!.textContent = '(' + tokens.length + ')';
  for (const token of tokens) {
    const item = document.createElement('li');
    item.append(tokenIcon(token));
    const text = document.createElement('div');
    text.className = 'token-metadata';
    const name = document.createElement('strong');
    name.textContent = token.symbol + ' · ' + token.decimals + ' decimals';
    const address = document.createElement('small');
    address.textContent = token.address === 'eth' ? 'Native Ethereum' : token.address;
    const status = document.createElement('small');
    status.setAttribute('role', 'status');
    text.append(name, address, status);
    const controls = document.createElement('div');
    controls.className = 'token-actions';
    const iconInput = document.createElement('input');
    iconInput.type = 'file';
    iconInput.accept = 'image/png,image/jpeg,image/webp';
    iconInput.className = 'icon-file';
    iconInput.setAttribute('aria-label', 'Change icon ' + token.symbol);
    const iconLabel = document.createElement('label');
    iconLabel.className = 'icon-upload';
    iconLabel.textContent = 'Change icon';
    iconLabel.append(iconInput);
    iconInput.onchange = async () => {
      const file = iconInput.files?.[0];
      if (!file) return;
      status.textContent = 'Saving icon…';
      status.append(spinner());
      iconInput.disabled = true;
      try {
        const icon = await readIcon(file);
        if (!tokens.includes(token)) return;
        token.icon = icon;
        persist(); renderTokens(); render();
      } catch (error) { status.textContent = (error as Error).message; }
      finally { iconInput.disabled = false; }
    };
    const remove = document.createElement('button');
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', 'Remove token ' + token.symbol);
    remove.onclick = () => {
      tokens.splice(tokens.indexOf(token), 1);
      wallets.forEach(wallet => {
        setTokenBalance(wallet, token, { failed: false });
        pruneTokenBalances(wallet);
        if (!tokens.some(asset => tokenBalance(wallet, asset).failed)) retries.cancel(wallet);
      });
      persist(); renderTokens(); render();
    };
    controls.append(iconLabel, remove);
    item.append(text, controls);
    list.append(item);
  }
}
function valuationFlags(estimate: ReturnType<typeof estimatedTotal>) {
  const flags = document.createElement('span'); flags.className = 'valuation-flags';
  if (estimate.known < estimate.count || estimate.decimalsMismatch) flags.append(statusIcon('partial', 'Partial', 'Partial value: only ' + estimate.known + ' of ' + estimate.count + ' holdings have a usable price. Unpriced holdings are excluded.'));
  if (estimate.stale) flags.append(statusIcon('stale', 'Stale', 'Includes ' + estimate.stale + ' saved or stale holding values.'));
  if (estimate.mixedBlocks) flags.append(statusIcon('unverified', 'Mixed finalized blocks', 'Holding values come from different verified finalized blocks.'));
  return flags;
}
function valuationAmount(estimate: ReturnType<typeof estimatedTotal>) {
  return estimate.known && !estimate.decimalsMismatch ? '≈ ' + formatBalance(displayValue(estimate.value), estimate.decimals + 18) : '—';
}
function renderTotals() {
  const estimate = estimatedTotal(wallets, tokens, pricing);
  const summary = document.querySelector('#estimated-total')!;
  const primary = document.createElement('div');
  const label = document.createElement('div'); label.className = 'portfolio-value-label'; label.textContent = 'Portfolio value';
  const value = document.createElement('div'); value.className = 'portfolio-value-amount';
  const number = document.createElement('strong'); number.className = 'portfolio-value-number'; number.textContent = valuationAmount(estimate); number.title = number.textContent;
  const currency = document.createElement('span'); currency.className = 'portfolio-value-currency'; currency.textContent = pricing.quote.symbol;
  value.append(number, document.createTextNode(' '), currency);
  primary.append(label, value);
  const metadata = document.createElement('div'); metadata.className = 'portfolio-value-meta';
  const coverage = document.createElement('span'); coverage.className = 'valuation-coverage'; coverage.textContent = estimate.known + ' / ' + estimate.count + ' priced';
  coverage.title = estimate.known + ' of ' + estimate.count + ' address/token holdings have usable price estimates.';
  const method = statusIcon('waiting', 'Price methodology', 'Estimated using 30-minute Uniswap v3 TWAPs from direct token/' + pricing.quote.symbol + ' pools at verified finalized blocks. Not a live trading quote.');
  metadata.append(coverage, valuationFlags(estimate), method);
  updateChildren(summary, [primary, metadata]);
  const totals = document.createDocumentFragment();
  if (!tokens.length) {
    const empty = document.createElement('p');
    empty.className = 'form-hint';
    empty.textContent = 'No tokens tracked. Add a token to show balances and totals.';
    totals.append(empty);
  }
  for (const total of portfolioTotals(wallets, tokens)) {
    const card = document.createElement('article');
    card.className = 'total';
    card.dataset.asset = total.id;
    card.setAttribute('aria-label', total.symbol + ' total' + (total.address !== 'eth' ? ' · ' + total.address : ''));
    const label = document.createElement('div');
    label.className = 'total-label';
    label.append(tokenIcon(total), document.createTextNode(total.symbol));
    label.title = total.address === 'eth' ? 'Native Ethereum' : total.address;
    if (total.loading) label.append(spinner());
    const amount = document.createElement('div');
    amount.className = 'total-amount';
    amount.textContent = total.amount === undefined ? '—' : formatBalance(total.amount, total.decimals);
    amount.title = amount.textContent;
    const status = document.createElement('small');
    status.className = 'total-status';
    const coverage = total.known + '/' + total.addresses + ' addresses';
    status.textContent = !total.addresses ? 'Add an address to start'
      : total.known < total.addresses ? 'Partial · ' + coverage : coverage;
    if (total.mixedBlocks) status.textContent += ' · mixed finalized blocks';
    if (total.stale) status.textContent += ' · ' + total.stale + ' stale';
    if (total.loading) status.textContent += ' · updating';
    status.title = status.textContent;
    card.classList.toggle('incomplete', total.known < total.addresses || total.stale > 0);
    const valuation = estimatedTotal(wallets, [total], pricing);
    const quote = document.createElement('div'); quote.className = 'token-value';
    quote.dataset.state = !valuation.known || valuation.decimalsMismatch ? 'unavailable' : valuation.known < valuation.count ? 'partial' : 'complete';
    quote.setAttribute('aria-label', total.symbol + ' estimated value in ' + pricing.quote.symbol);
    quote.title = valuation.known + ' of ' + valuation.count + ' addresses priced; 30-minute direct-pool TWAP.';
    const subtotal = document.createElement('span'); subtotal.className = 'token-value-amount';
    subtotal.textContent = valuationAmount(valuation) + ' ' + pricing.quote.symbol;
    quote.title = subtotal.textContent + ' · ' + quote.title;
    quote.append(subtotal, valuationFlags(valuation));
    const amounts = document.createElement('div'); amounts.className = 'total-balances'; amounts.append(amount, quote);
    card.append(label, amounts, status);
    totals.append(card);
  }
  updateChildren(document.querySelector('#totals')!, [...totals.childNodes]);
}
let progressTimer: ReturnType<typeof setInterval> | undefined;
function progressClock(startedAt: number, deadline?: number) {
  const clock = document.createElement('small'); clock.className = 'progress-clock';
  clock.dataset.progressStart = String(startedAt);
  if (deadline) clock.dataset.progressDeadline = String(deadline);
  clock.setAttribute('aria-live', 'off');
  clock.textContent = progressTime(startedAt, Date.now(), deadline);
  return clock;
}
function syncProgressClock() {
  if (!wallets.some(wallet => wallet.loading && !wallet.queuedForVerifier)) { clearInterval(progressTimer); progressTimer = undefined; return; }
  if (progressTimer) return;
  progressTimer = setInterval(() => {
    document.querySelectorAll<HTMLElement>('[data-progress-start]').forEach(clock => {
      clock.textContent = progressTime(Number(clock.dataset.progressStart), Date.now(), clock.dataset.progressDeadline ? Number(clock.dataset.progressDeadline) : undefined);
    });
  }, 1000);
}
function verificationPanel(wallet: Wallet) {
  const panel = document.createElement('section'); panel.className = 'verification-panel';
  panel.setAttribute('aria-label', 'Verification progress');
  const stage = wallet.verificationStage || 'connection';
  const phases: VerificationStage[] = ['verifier', 'consensus', 'balances', 'pricing'];
  const index = !wallet.loading ? 4 : stage === 'queued' ? 0 : stage === 'balances-pricing' ? 2 : phases.indexOf(stage);
  const steps = document.createElement('ol'); steps.className = 'verification-stages';
  ['Verifier', 'Consensus', 'Balances', 'Prices'].forEach((label, step) => {
    const item = document.createElement('li'); item.textContent = label; item.dataset.viewKey = label;
    item.className = !wallet.loading ? '' : step < index ? 'completed' : (step === index || stage === 'balances-pricing' && step === 3) ? 'current' : '';
    if (wallet.loading && (step === index || stage === 'balances-pricing' && step === 3)) item.setAttribute('aria-current', 'step');
    steps.append(item);
  });
  const heading = document.createElement('div'); heading.className = 'progress-heading';
  const title = document.createElement('strong'); title.textContent = wallet.loading ? stage === 'connection' ? 'Verification' : stageLabels[stage] : 'Read attempt finished';
  title.title = title.textContent;
  const active = wallet.loading && !wallet.queuedForVerifier && stage !== 'connection';
  const clock = active ? progressClock(wallet.stageStartedAt || Date.now()) : document.createElement('small');
  clock.className = 'progress-clock';
  if (!active) clock.textContent = 'No request running';
  heading.append(title, clock);
  panel.append(steps, heading);
  const requestArea = document.createElement('div'); requestArea.className = 'progress-requests';
  const requests = wallet.networkRequests || [];
  if (wallet.loading && requests.length) {
    for (const request of requests.slice(0, 2)) {
      const row = document.createElement('div'); row.className = 'progress-request'; row.dataset.viewKey = String(request.requestId);
      const operation = document.createElement('p'); operation.textContent = request.method + ' → ' + request.host;
      const state = document.createElement('span'); state.textContent = request.state === 'waiting' ? 'Submitted to Anon-RPC · waiting for response headers' : 'Response headers received · reading response body';
      row.append(operation, state, progressClock(request.startedAt, request.deadline));
      operation.title = operation.textContent; state.title = state.textContent;
      requestArea.append(row);
    }
    const hint = document.createElement('p'); hint.className = 'progress-hint';
    hint.textContent = requests.length > 2 ? '+' + (requests.length - 2) + ' more private requests' : '';
    requestArea.append(hint);
  } else {
    const operation = document.createElement('p'); operation.className = 'verification-progress';
    operation.setAttribute('role', 'status');
    const detail = wallet.verificationStatus || '';
    operation.textContent = wallet.loading && stage !== 'connection' && stage !== 'queued' && detail !== stageLabels[stage] ? detail : '';
    operation.title = operation.textContent;
    requestArea.append(operation);
  }
  panel.append(requestArea);
  return panel;
}
function detailDisclosure(className: string, label: string, content: Node) {
  const details = document.createElement('details'); details.className = 'detail-disclosure ' + className;
  details.dataset.viewKey = className;
  const summary = document.createElement('summary'); summary.textContent = label;
  const body = document.createElement('div'); body.className = 'disclosure-body'; body.append(content);
  details.append(summary, body);
  details.ontoggle = event => { const node = event.currentTarget as HTMLDetailsElement; if (!node.open) node.querySelector<HTMLElement>('.disclosure-body')!.style.minHeight = ''; };
  return details;
}
function walletDetails(wallet: Wallet, logOpen=false) {
  const content = document.createElement('div');
  content.className = 'detail-content';
  content.dataset.address = wallet.address;
  content.tabIndex = 0;
  content.setAttribute('aria-label', 'Read progress and results for ' + wallet.address);
  content.append(verificationPanel(wallet));
  const failures = document.createDocumentFragment();
  let failureCount = 0;
  for (const token of tokens) {
    const balance = tokenBalance(wallet, token);
    const failure = balanceFailure(balance);
    if (failure) { failures.append(failureReport(token.symbol + ' balance', failure, new URL(wallet.rpcUrl).hostname, token.address + ':balance')); failureCount++; }
    if (balance.priceError) { failures.append(failureReport(token.symbol + ' price', { message: errorMessage(balance.priceError), stage: 'Pricing oracle', at: 0 }, new URL(wallet.rpcUrl).hostname, token.address + ':price')); failureCount++; }
  }
  if (wallet.activity.length) {
    const activity = document.createElement('div');
    activity.className = 'activity';
    const summary = document.createElement('p');
    const finished = wallet.activity.filter(item => item.phase === 'received' || item.phase === 'failed').length;
    summary.textContent = finished + '/' + wallet.activity.length + ' reads finished';
    const retry = retryMessage(wallet);
    if (retry) summary.textContent += ' ' + retry;
    summary.title = summary.textContent;
    activity.append(summary);
    wallet.activity.filter(item => tokens.some(token => token.address === item.asset)).forEach(item => {
      const line = document.createElement('div');
      line.className = 'activity-item ' + item.phase; line.dataset.asset = item.asset;
      const indicator = document.createElement('span'); indicator.className = 'activity-indicator';
      if (wallet.loading && item.phase === 'requesting') indicator.append(spinner());
      line.append(indicator);
      const detail = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = item.symbol + ' · ' + (item.phase === 'waiting' ? 'Pending'
        : item.phase === 'requesting' ? (item.attempt > 1 ? 'Retry ' + (item.attempt - 1) + ' on the same private route; verifying finalized state' : 'Verifying locally; fetching private proofs as needed')
        : item.phase === 'received' ? 'Balance received' : 'Read failed; previous amount kept if available');
      const payload = document.createElement('small');
      payload.textContent = item.phase === 'waiting' || item.phase === 'received' || item.phase === 'failed' ? '' : item.description;
      title.title = title.textContent; payload.title = payload.textContent;
      detail.append(title, payload);
      line.append(detail);
      activity.append(line);
    });
    content.append(activity);
  }
  if (!failureCount) { const empty = document.createElement('p'); empty.className = 'form-hint'; empty.textContent = 'No read errors.'; failures.append(empty); }
  content.append(detailDisclosure('failure-details', 'Read errors · ' + failureCount, failures), detailDisclosure('history-details', 'Read history', readHistory(wallet, tokens)), logStream(wallet, logOpen));
  const frame = document.createElement('div'); frame.className = 'detail-inner';
  frame.append(content);
  return frame;
}
function render() {
  const viewport = captureViewport(walletList);
  const logs = new Map([...walletList.querySelectorAll<HTMLDetailsElement>('.retrieval-log')].map(node => {
    return [node.closest<HTMLElement>('.wallet')!.dataset.address,{open:node.open}] as const;
  }));
  const openFailures = new Set([...walletList.querySelectorAll('.failure-technical[open]')].map(node => node.closest('.detail-content')?.getAttribute('data-address') + ':' + node.closest('.read-failure')?.getAttribute('data-view-key')));
  syncProgressClock();
  renderTotals();
  document.querySelector('#count')!.textContent = String(wallets.length);
  const activeElement = document.activeElement as HTMLElement | null;
  const focus = activeElement?.getAttribute('aria-label');
  const focusAddress = activeElement?.closest<HTMLElement>('.wallet')?.dataset.address;
  const focusAsset = activeElement?.closest<HTMLElement>('.balance')?.dataset.asset;
  if (!wallets.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<h3>Your watchlist starts here</h3><p>Add an Ethereum address or a list to read its balances.</p>';
    updateChildren(walletList, [empty]);
    return;
  }
  const assets = tokens;
  const table = document.createElement('table');
  table.className = 'wallet-table';
  table.style.setProperty('--token-count', String(assets.length));
  const colgroup = document.createElement('colgroup');
  for (const kind of ['address', ...assets.map(() => 'token'), 'actions']) {
    const col = document.createElement('col'); col.className = 'wallet-column-' + kind; colgroup.append(col);
  }
  table.append(colgroup);
  const caption = document.createElement('caption');
  caption.className = 'sr-only';
  caption.textContent = 'Token balances by tracked address. Expand a row for timestamps and private request progress.';
  const head = document.createElement('thead');
  const columns = document.createElement('tr');
  for (const entry of ['Address / refresh', ...assets, 'Actions']) {
    const column = document.createElement('th');
    column.scope = 'col';
    if (entry === 'Actions') { column.setAttribute('aria-label', 'Address details'); }
    else if (typeof entry === 'string') column.textContent = entry;
    else {
      const label = document.createElement('span');
      label.className = 'column-token';
      label.append(tokenIcon(entry), document.createTextNode(entry.symbol));
      column.append(label);
      column.title = entry.address === 'eth' ? 'Native Ethereum' : entry.address;
    }
    columns.append(column);
  }
  head.append(columns);
  table.append(caption, head);
  wallets.forEach(wallet => {
    const card = document.createElement('tbody');
    card.className = 'wallet';
    card.dataset.loading = String(wallet.loading);
    card.dataset.address = wallet.address;
    const row = document.createElement('tr');
    row.className = 'balances';
    row.setAttribute('aria-busy', String(wallet.loading));
    const identity = document.createElement('th');
    identity.scope = 'row';
    identity.className = 'wallet-head';
    const address = addressDisplay(wallet, true);
    const refresh = document.createElement('button');
    refresh.className = 'refresh-icon';
    refresh.textContent = wallet.loading ? '' : '↻';
    if (wallet.loading && !wallet.queuedForVerifier) refresh.append(spinner());
    else if (wallet.queuedForVerifier) refresh.textContent = '…';
    refresh.disabled = wallet.loading || !tokens.length;
    refresh.title = wallet.queuedForVerifier ? 'Queued for verification' : wallet.loading ? 'Reading balances' : !tokens.length ? 'Add a token to retrieve balances' : 'Refresh this address';
    refresh.setAttribute('aria-label', (wallet.queuedForVerifier ? 'Queued ' : wallet.loading ? 'Reading ' : 'Refresh ') + wallet.address + (wallet.name ? ' · ' + wallet.name : ''));
    refresh.onclick = () => { void refreshWallet(wallet); };
    const addressLine = document.createElement('div');
    addressLine.className = 'address-line';
    addressLine.append(address, refresh);
    identity.append(addressLine);
    {
      const progress = document.createElement('small');
      progress.className = 'verification-progress compact-progress';
      const request = wallet.networkRequests?.[0];
      progress.textContent = request ? (request.state === 'waiting' ? 'Waiting for ' : 'Receiving ') + request.method + ' · ' + request.host : stageLabels[wallet.verificationStage || 'connection'];
      progress.title = wallet.verificationStatus || '';
      if (!wallet.loading || wallet.verificationStage === 'connection' || expandedAddresses.has(wallet.address)) { progress.textContent = ''; progress.setAttribute('aria-hidden', 'true'); }
      identity.append(progress);
    }
    row.append(identity);
    const pending = (asset: string) => wallet.loading && wallet.verificationStage !== 'connection' && !wallet.queuedForVerifier && wallet.activity.some(item => item.asset === asset && (item.phase === 'waiting' || item.phase === 'requesting'));
    row.append(...assets.map(token => balanceNode(wallet, token.symbol, token.decimals, tokenBalance(wallet, token), pending(token.address), token.address)));
    const actions = document.createElement('td');
    actions.className = 'actions';
    const expanded = expandedAddresses.has(wallet.address);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'details-toggle';
    toggle.innerHTML = chevronDown;
    toggle.title = expanded ? 'Collapse address details' : 'Expand address details';
    toggle.setAttribute('aria-label', 'Details ' + wallet.address + (wallet.name ? ' · ' + wallet.name : ''));
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-controls', 'details-' + wallet.address);
    toggle.onclick = () => {
      if (expandedAddresses.has(wallet.address)) expandedAddresses.delete(wallet.address);
      else expandedAddresses.add(wallet.address);
      render();
    };
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-address';
    remove.textContent = 'Remove address';
    remove.title = 'Remove address';
    remove.setAttribute('aria-label', 'Remove ' + wallet.address + (wallet.name ? ' · ' + wallet.name : ''));
    remove.onclick = () => {
      const label = wallet.name ? `${wallet.name}\n${wallet.address}` : wallet.address;
      if (!window.confirm(`Remove this tracked address?\n\n${label}\n\nIts saved balances will also be removed from this browser.`)) return;
      retries.cancel(wallet);
      expandedAddresses.delete(wallet.address);
      wallets.splice(wallets.indexOf(wallet), 1);
      persist(); render();
    };
    actions.append(toggle);
    row.append(actions);
    const details = document.createElement('tr');
    details.id = 'details-' + wallet.address;
    details.className = 'wallet-details';
    details.hidden = !expanded;
    const detailCell = document.createElement('td');
    detailCell.colSpan = assets.length + 2;
    const content = walletDetails(wallet, logs.get(wallet.address)?.open);
    const detailActions = document.createElement('div');
    detailActions.className = 'detail-actions';
    detailActions.append(remove);
    content.append(detailActions);
    detailCell.append(content);
    details.append(detailCell);
    card.append(row, details);
    table.append(card);
  });
  updateChildren(walletList, [table]);
  walletList.querySelectorAll<HTMLDetailsElement>('.failure-technical').forEach(node => {
    node.open = openFailures.has(node.closest('.detail-content')?.getAttribute('data-address') + ':' + node.closest('.read-failure')?.getAttribute('data-view-key'));
  });
  restoreViewport(walletList, viewport);
  if (focus) {
    const card = [...walletList.querySelectorAll<HTMLElement>('.wallet')].find(node => node.dataset.address === focusAddress);
    const cell = card && [...card.querySelectorAll<HTMLElement>('.balance')].find(node => node.dataset.asset === focusAsset);
    const scope = cell || card || walletList;
    [...scope.querySelectorAll<HTMLElement>('[aria-label]')].find(node => node.getAttribute('aria-label') === focus)?.focus({ preventScroll: true });
  }
}
function pruneTokenBalances(wallet: Wallet) {
  for (const token of defaultTokens()) {
    if (!tokens.some(asset => asset.address === token.address)) setTokenBalance(wallet, token, { failed: false });
  }
  for (const address of Object.keys(wallet.tokens)) {
    if (!tokens.some(token => token.address === address)) delete wallet.tokens[address];
  }
}
async function refreshWallet(wallet: Wallet, onlyFailed = false) {
  if (wallet.loading) { wallet.queuedRefresh = true; return; }
  if (!wallets.includes(wallet)) return;
  if (!tokens.length) { retries.cancel(wallet); wallet.queuedRefresh = false; return; }
  if (onlyFailed) retries.begin(wallet);
  else retries.cancel(wallet);
  const selectedTokens = [...tokens];
  wallet.loading = true;
  wallet.verificationStage = 'connection';
  wallet.stageStartedAt = Date.now();
  wallet.networkRequests = [];
  wallet.queuedForVerifier = false;
  appendRetrievalLog(wallet, (onlyFailed?'Automatic retry':'Refresh')+' started · '+new URL(wallet.rpcUrl).hostname+' through the address’s Anon-RPC route.');
  appendRetrievalLog(wallet, state==='ready'?'Using the ready private worker.':connectionMessage);
  prepareActivity(wallet, selectedTokens, onlyFailed);
  render();
  try {
    if (!navigator.onLine) throw new Error('Offline');
    const worker = await connection.get();
    appendRetrievalLog(wallet,'Private worker ready; requesting finalized verification.');
    if (wallets.includes(wallet)) await readBalances(wallet, worker, selectedTokens, () => { pruneTokenBalances(wallet); persist(); render(); }, onlyFailed);
  } catch (cause) {
    const failure = readFailure(navigator.onLine ? cause : 'Browser is offline.', 'Starting the private connection');
    wallet.verificationStatus = failure.message;
    appendRetrievalLog(wallet,'Refresh failed: '+failure.message,'error');
    wallet.activity.forEach(item => {
      const token = selectedTokens.find(token => token.address === item.asset);
      if (token) { tokenBalance(wallet, token).failed = true; tokenBalance(wallet, token).failure = failure; }
      item.phase = 'failed';
    });
  } finally {
    wallet.loading = false;
    wallet.networkRequests = [];
    wallet.queuedForVerifier = false;
    pruneTokenBalances(wallet);
    persist(); render();
    if (!wallets.includes(wallet)) { retries.cancel(wallet); return; }
    const failed = tokens.some(token => tokenBalance(wallet, token).failed);
    if (wallet.queuedRefresh && !failed) { wallet.queuedRefresh = false; void refreshWallet(wallet); }
    else if (failed) { wallet.queuedRefresh = false; retries.schedule(wallet); }
    else retries.cancel(wallet);
  }
}
async function start(automatic = false) {
  if (automatic) retries.begin('connection');
  else retries.cancel('connection');
  if (!navigator.onLine) { state = 'failed'; retries.schedule('connection'); renderConnection(); return; }
  try { await connection.get(); }
  catch { state = 'failed'; retries.schedule('connection'); renderConnection(); }
}
document.querySelector('#wallet-form')!.addEventListener('submit', event => {
  event.preventDefault();
  let addresses;
  try { addresses = parseTrackedAddresses(input.value, document.querySelector<HTMLInputElement>('#address-name')!.value); }
  catch (cause) {
    error.textContent = (cause as Error).message;
    input.setAttribute('aria-invalid', 'true');
    return;
  }
  const additions = addresses.filter(entry => !wallets.some(wallet => wallet.address === entry.address));
  if (!additions.length) { error.textContent = 'This wallet is already on your watchlist.'; return; }
  input.removeAttribute('aria-invalid');
  error.textContent = '';
  const added: Wallet[] = [];
  for (const entry of additions) {
    const used = new Set(wallets.map(wallet => wallet.rpcUrl));
    const rpc = config.rpcUrls.find(url => !used.has(url)) || config.rpcUrls[wallets.length % config.rpcUrls.length]!;
    const wallet = makeWallet(entry.address, rpc);
    wallet.name = entry.name;
    wallets.push(wallet); added.push(wallet);
  }
  persist();
  document.querySelector('#wallet-notice')!.textContent = 'Added ' + added.length + ' wallet' + (added.length === 1 ? '' : 's') + '. Existing entries were skipped.';
  input.value = '';
  document.querySelector<HTMLInputElement>('#address-name')!.value = '';
  addressPanel.open = false;
  addressToggle.focus({ preventScroll: true });
  document.querySelector<HTMLDetailsElement>('.token-settings')!.open = false;
  document.querySelector<HTMLDetailsElement>('#network-settings')!.open = false;
  added.forEach(wallet => { void refreshWallet(wallet); });
});
document.querySelector<HTMLSelectElement>('#token-preset')!.addEventListener('change', event => {
  const preset = (event.target as HTMLSelectElement).value;
  const token = defaultTokens().find(token => preset === 'eth' ? token.address === 'eth' : token.symbol === preset.toUpperCase());
  const address = document.querySelector<HTMLInputElement>('#token-address')!;
  const decimals = document.querySelector<HTMLInputElement>('#token-decimals')!;
  address.value = token?.address === 'eth' ? 'Native ETH' : token?.address || '';
  address.readOnly = token?.address === 'eth';
  document.querySelector<HTMLInputElement>('#token-symbol')!.value = token?.symbol || '';
  decimals.value = String(token?.decimals ?? 18);
  decimals.readOnly = token?.address === 'eth';
  document.querySelector<HTMLInputElement>('#token-icon')!.value = '';
});
let savingToken = false;
document.querySelector('#token-form')!.addEventListener('submit', async event => {
  event.preventDefault();
  if (savingToken) return;
  const tokenError = document.querySelector('#token-error')!;
  const field = (id: string) => document.querySelector<HTMLInputElement>('#' + id)!;
  const preset = document.querySelector<HTMLSelectElement>('#token-preset')!;
  const submit = document.querySelector<HTMLButtonElement>('#token-form button[type="submit"]')!;
  let token: Token;
  try {
    token = validateToken(preset.value === 'eth' ? 'eth' : field('token-address').value, field('token-symbol').value, field('token-decimals').value);
    if (tokens.some(t => t.address === token.address)) throw new Error('This token is already tracked.');
    savingToken = true;
    submit.disabled = true;
    const file = field('token-icon').files?.[0];
    if (file) {
      submit.textContent = 'Preparing icon…';
      submit.prepend(spinner());
      token.icon = await readIcon(file);
    }
    tokens.push(token);
    tokenError.textContent = '';
    preset.value = 'custom';
    field('token-address').value = field('token-symbol').value = field('token-icon').value = '';
    field('token-address').readOnly = field('token-decimals').readOnly = false;
    field('token-decimals').value = '18';
    persist(); renderTokens(); render();
    wallets.forEach(wallet => { void refreshWallet(wallet); });
  } catch (error) { tokenError.textContent = (error as Error).message; }
  finally { savingToken = false; submit.disabled = false; submit.textContent = 'Add token'; }
});
const settingsField = (id: string) => document.querySelector<HTMLInputElement | HTMLTextAreaElement>('#settings-' + id)!;
let stagedWorker: WorkerMetadata | undefined = config.torWorker;
function renderWorkerMetadata() {
  document.querySelector('#tor-worker-metadata')!.textContent = stagedWorker
    ? 'Saved worker hash: ' + stagedWorker.hash + '\nDiscovery block: ' + stagedWorker.blockNumber + '\nDownload locations:\n' + stagedWorker.resolvers.join('\n')
    : 'No updated worker saved. The bundled worker is used by default.';
  const option = document.querySelector<HTMLOptionElement>('#settings-tor-worker option[value="updated"]')!;
  option.disabled = !stagedWorker;
}
function showSettings(settings: NetworkSettings) {
  stagedWorker = settings.torWorker;
  settingsField('tor-worker').value = stagedWorker ? 'updated' : 'bundled';
  renderWorkerMetadata();
  settingsField('gateways').value = settings.gateways.join('\n');
  settingsField('rpcs').value = settings.rpcUrls.join('\n');
  const checkpoint = settings.checkpoint || DEFAULT_CHECKPOINT;
  settingsField('checkpoint-root').value = checkpoint.root;
  settingsField('checkpoint-slot').value = String(checkpoint.slot);
}
showSettings(config);
document.querySelector('#update-tor-worker')!.addEventListener('click', async () => {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('#settings-form button')];
  buttons.forEach(button => { button.disabled = true; });
  const status = document.querySelector('#tor-worker-status')!;
  const update = (message: string) => { status.replaceChildren(spinner(), document.createTextNode(' ' + message)); };
  try {
    const metadata = await discoverTorWorker(update);
    await cacheTorWorker(metadata, update);
    stagedWorker = metadata;
    renderWorkerMetadata();
    settingsField('tor-worker').value = 'updated';
    status.textContent = 'Update downloaded and hash-checked. Review the hash and locations, then Save settings and reconnect to use it.';
  } catch (error) { status.textContent = 'Tor worker update failed: ' + errorMessage(error) + ' Your current worker is unchanged.'; }
  finally { buttons.forEach(button => { button.disabled = false; }); }
});
function applySettings(settings: NetworkSettings | null) {
  const message = document.querySelector('#settings-error')!;
  if (!saveSettings(settings)) {
    message.textContent = 'Browser storage is unavailable or full. Settings could not be saved; the current connection is still in use.';
    return;
  }
  // Navigation discards the old worker and all clients together. No in-flight read
  // can update a wallet or retry on an old endpoint in the new session.
  connection.close();
  window.location.reload();
}
document.querySelector('#settings-form')!.addEventListener('submit', event => {
  event.preventDefault();
  try {
    const lines = (value: string) => value.split(/[,\n]/).map(line => line.trim()).filter(Boolean);
    const settings = validateSettings({ torWorker: settingsField('tor-worker').value === 'updated' ? stagedWorker : undefined, gateways: lines(settingsField('gateways').value), rpcUrls: lines(settingsField('rpcs').value),
      checkpoint: { root: settingsField('checkpoint-root').value, slot: Number(settingsField('checkpoint-slot').value) } });
    checkCheckpointAge(Date.now(), settings.checkpoint);
    applySettings(settings);
  } catch (cause) { document.querySelector('#settings-error')!.textContent = (cause as Error).message; }
});
document.querySelector('#reset-settings')!.addEventListener('click', () => {
  showSettings(defaultConfig);
  applySettings(null);
});
function renderOffline() {
  document.querySelector('#offline-notice')!.textContent = navigator.onLine ? ''
    : 'You appear to be offline. Saved wallets, tokens and balances remain available. Failed reads will retry when the connection returns.';
}
renderTokens(); render(); renderConnection(); renderOffline();
void start();
wallets.forEach(wallet => { void refreshWallet(wallet); });
window.addEventListener('offline', () => { retries.pause(); renderOffline(); });
window.addEventListener('online', () => { renderOffline(); retries.resume(); void start(); });
window.addEventListener('pagehide', () => { retries.pause(); connection.close(); });
window.addEventListener('pageshow', event => { if (event.persisted) { retries.resume(); void start(); } });
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {
    document.querySelector('#offline-notice')!.textContent = 'Offline page caching is unavailable. Balances are still saved locally, but reopening the page may need a connection.';
  });
}

const pricingPreset = document.querySelector<HTMLSelectElement>('#pricing-preset')!;
const quoteAddress = document.querySelector<HTMLInputElement>('#pricing-address')!;
const quoteSymbol = document.querySelector<HTMLInputElement>('#pricing-symbol')!;
const quoteDecimals = document.querySelector<HTMLInputElement>('#pricing-decimals')!;
const quoteLiquidity = document.querySelector<HTMLInputElement>('#pricing-liquidity')!;
const presetQuote = defaultPricing().quote;
pricingPreset.value = pricing.quote.address === presetQuote.address && pricing.quote.decimals === presetQuote.decimals && pricing.quote.symbol === presetQuote.symbol ? 'usdc' : 'custom';
quoteAddress.value = pricing.quote.address; quoteSymbol.value = pricing.quote.symbol;
quoteDecimals.value = String(pricing.quote.decimals); quoteLiquidity.value = pricing.minLiquidity;
function showPricingCustom() { document.querySelector<HTMLElement>('#pricing-custom')!.hidden = pricingPreset.value !== 'custom'; }
pricingPreset.onchange = showPricingCustom; showPricingCustom();
document.querySelector('#pricing-form')!.addEventListener('submit', event => {
  event.preventDefault();
  const error = document.querySelector('#pricing-error')!;
  try {
    const next = validatePricing({ quote: pricingPreset.value === 'usdc' ? defaultPricing().quote : { address: quoteAddress.value, symbol: quoteSymbol.value, decimals: Number(quoteDecimals.value) }, minLiquidity: quoteLiquidity.value });
    if (!savePricing(next)) throw new Error('Browser storage unavailable; pricing settings were not changed.');
    pricing = next;
    // Old quote settings must never be mixed with freshly requested valuations.
    wallets.forEach(wallet => tokens.forEach(token => { delete tokenBalance(wallet, token).estimate; delete tokenBalance(wallet, token).priceError; }));
    error.textContent = ''; persist(); render(); closeSettings();
    wallets.forEach(wallet => { void refreshWallet(wallet); });
  } catch (cause) { error.textContent = (cause as Error).message; }
});
