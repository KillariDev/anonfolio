import { explain, explanationGroup, installTooltips } from './tooltips';
import { verificationPanel } from './verification-panel';
import { pageMarkup } from './page';
import { heliosStatus, subscribeHeliosStatus } from './verification/status';
import { exactBalance } from './formatting';
import { technologyIcon } from './technology-icons';
import { visibleHoldings } from './holdings';
import { captureViewport, restoreViewport } from './viewport';
import { updateChildren } from './dom';
import { appendRetrievalLog } from './retrieval-log';
import { logStream } from './log-stream';
import { readHistory } from './read-history';
import { checkLabel, stageLabels, progressTime } from './verification/progress';
import chevronDown from './assets/chevron-down.svg?raw';
import { discoverTorWorker, cacheTorWorker } from './worker-update';
import type { WorkerMetadata } from './worker-metadata';
import { DEFAULT_CHECKPOINT, checkCheckpointAge } from './verification/trust';
import appIcon from './assets/branding/anonfolio-mark.svg?no-inline';
import { addressDisplay } from './address-display';
import { parseTrackedAddresses } from './addresses';
import { config, defaultConfig } from './config';
import { saveSettings, validateSettings, type NetworkSettings } from './settings';
import { errorMessage, explainFailure, failureEndpoint, readFailure, type ReadFailure } from './errors';
import { Connection, type ConnectionState } from './connection';
import { formatBalance, makeWallet, prepareActivity, readBalances, tokenBalance, setTokenBalance, type Balance, type Wallet } from './balances';
import { loadPortfolio, savePortfolio, syncPortfolio, PORTFOLIO_KEY } from './storage';
import { validateToken, defaultTokens, type Token } from './tokens';
import { RetryQueue, retryDelay } from './retries';
import { loadPricing, savePricing, validatePricing, defaultPricing, usableEstimate, valueFraction, displayValue, retryPrice, pricingSettingsKey, PRICING_KEY, type PricingSettings } from './pricing';
import { estimatedTotal, portfolioTotals } from './totals';
import { readIcon, tokenIcon, statusIcon, type StatusIcon } from './icons';
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = pageMarkup(appIcon);

installTooltips();

document.querySelector('.network i')!.replaceWith(technologyIcon('ethereum', true));
document.querySelector('#pricing-form h2')!.prepend(technologyIcon('uniswap', true));

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
  key => connection.cancelled ? undefined : key === 'connection' ? start(true) : refreshWallet(key, true),
  () => navigator.onLine,
  () => {
    for (const wallet of wallets) {
      const connectionRetry=state==='failed'?retryMessage('connection'):'';
      const message=[retryMessage(wallet),connectionRetry?(config.mode === 'https' ? 'HTTPS connection: ' : 'Private connection: ')+connectionRetry:''].filter(Boolean).join(' ');
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
    for(const wallet of wallets) if(wallet.loading) appendRetrievalLog(wallet,(config.mode === 'https' ? 'HTTPS connection: ' : 'Private connection: ')+next,next==='failed'?'error':'info');
    if (next === 'failed' && !connection.cancelled) retries.schedule('connection');
    else if (next === 'ready') retries.cancel('connection');
    renderConnection();
  },
  message => { connectionMessage = message; for(const wallet of wallets) if(wallet.loading) appendRetrievalLog(wallet,message); renderConnection(); if(wallets.some(wallet=>wallet.loading)) render(); },
);
let persistence: Promise<unknown> | undefined;
let persistAgain = false;
function reconcileRemoved(before: Wallet[]) {
  for (const wallet of before) if (!wallets.includes(wallet)) {
    cancelRefresh(wallet); expandedAddresses.delete(wallet.address);
  }
}
function persist() {
  persistAgain = true;
  if (persistence) return;
  const warning = document.querySelector('#storage-warning')!;
  if (!navigator.locks) {
    warning.textContent = 'Safe browser storage requires Web Locks. Changes remain visible in this tab but could not be saved. Use a current browser on HTTPS or localhost.';
    return;
  }
  persistence = navigator.locks.request(PORTFOLIO_KEY, () => {
    persistAgain = false;
    const before = [...wallets], previousTokens = JSON.stringify(tokens);
    const saved = savePortfolio(wallets, tokens);
    warning.textContent = saved ? '' : 'Browser storage is unavailable or full. Changes and new balances are visible now but could not be saved.';
    reconcileRemoved(before);
    if (JSON.stringify(tokens) !== previousTokens) renderTokens();
    render();
  }).catch(() => {
    persistAgain = false;
    warning.textContent = 'Browser storage could not be locked. Changes remain visible but could not be saved.';
  }).finally(() => { persistence = undefined; if (persistAgain) persist(); });
}
window.addEventListener('storage', event => {
  if (event.storageArea !== localStorage) return;
  if (event.key === PRICING_KEY || event.key === null) {
    adoptPricing(loadPricing());
    showPricingSettings();
    render();
  }
  if (event.key !== PORTFOLIO_KEY && event.key !== null) return;
  const before = [...wallets], previousTokens = JSON.stringify(tokens);
  syncPortfolio(wallets, tokens, config.rpcUrls);
  reconcileRemoved(before);
  if (JSON.stringify(tokens) !== previousTokens) renderTokens();
  render();
});
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
function renderHeliosStatus() {
  const node = document.querySelector<HTMLElement>('#helios-status')!;
  const status = heliosStatus();
  node.className = 'helios-indicator ' + status.phase;
  const labels = { idle: 'idle', starting: 'starting', syncing: 'syncing', ready: 'ready', unavailable: 'unavailable' };
  const description = status.phase === 'idle' ? 'Helios starts when you refresh an address.'
    : status.phase === 'starting' ? 'Loading and checking the pinned Helios verifier.'
    : status.phase === 'syncing' ? 'Verifying Ethereum consensus signatures and finalized headers.'
    : status.phase === 'unavailable' ? errorMessage(status.error || 'Helios verification is unavailable. Refresh an address to retry.')
    : status.block ? 'Last verified finalized block ' + BigInt(status.block.number) + ' · ' + new Date(status.block.timestamp).toLocaleString()
    : 'Helios light client is ready.';
  explain(node, description);
  const busy = status.phase === 'starting' || status.phase === 'syncing';
  const icon = busy ? spinner() : statusIcon(status.phase === 'ready' ? 'verified' : status.phase === 'unavailable' ? 'unavailable' : 'waiting', description);
  // The pill itself is keyboard-focusable and exposes one shared tooltip.
  icon.removeAttribute('tabindex');
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('strong');
  label.textContent = 'Helios · ' + labels[status.phase];
  updateChildren(node, [icon, label]);
}
function renderConnection() {
  const node = document.querySelector<HTMLElement>('#connection')!;
  node.className = 'connection ' + state;
  node.setAttribute('aria-label', config.mode === 'https' ? 'HTTPS connection' : 'Private connection');
  const heading = document.createElement('div');
  heading.className = 'connection-heading';
  if (config.mode !== 'https') {
    const badge = document.createElement('span');
    badge.className = 'connection-technology';
    badge.append(technologyIcon('tor'));
    heading.append(badge);
  }
  const indicator = state === 'starting' ? spinner() : document.createElement('span');
  indicator.classList.add('connection-indicator');
  indicator.setAttribute('aria-hidden', 'true');
  heading.append(indicator);
  const title = document.createElement('strong');
  title.textContent = config.mode === 'https' ? state === 'ready' ? 'Direct HTTPS · not anonymous' : state === 'starting' ? 'Starting HTTPS connection…' : 'HTTPS connection unavailable'
    : state === 'ready' ? 'Private worker ready' : state === 'starting' ? connection.phase || 'Starting private connection…' : connection.cancelled ? 'Connection cancelled' : 'Private connection unavailable';
  if (state === 'starting' && connection.slow) { title.textContent += ' Taking longer than usual.'; title.title = 'Keeping this Tor bootstrap attempt alive for up to five minutes. You can cancel or keep using saved balances.'; }
  if (!title.title) title.title = title.textContent;
  heading.append(title);
  if (state === 'failed') title.title = [connection.lastError, retryMessage('connection')].filter(Boolean).join(' · ');
  if (state === 'starting') {
    const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.setAttribute('aria-label', 'Cancel connection'); cancel.title = 'Cancel connection';
    cancel.onclick = () => {
      connection.cancel(); retries.cancel('connection');
      wallets.forEach(wallet => { const pending = wallet.loading; cancelRefresh(wallet); if (pending) cancelledRefreshes.add(wallet); });
    };
    heading.append(cancel);
  }
  if (state === 'failed') {
    const button = document.createElement('button');
    button.textContent = 'Retry connection'; button.title = 'Retry connection';
    button.onclick = event => { event.preventDefault(); event.stopPropagation(); void start(); };
    heading.append(button);
  }
  updateChildren(node, [heading]);
  explanationGroup(node, title.title || title.textContent || 'Connection status');
}
function failureReport(label: string, failure: ReadFailure, rpcHost?: string, identity = label) {
  const report = document.createElement('section'); report.className = 'read-failure';
  report.setAttribute('aria-label', label + ' failure');
  report.dataset.viewKey = identity;
  const { summary, action } = explainFailure(failure, config.mode);
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
function visiblePriceFailure(balance: Balance) {
  return balance.priceFailure && balance.priceFailure.settingsKey !== pricingSettingsKey(pricing) ? undefined : balance.priceError;
}
function balanceNode(wallet: Wallet, symbol: string, decimals: number, balance: Balance, pending: boolean, asset: string) {
  const box = document.createElement('div');
  box.className = 'balance';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', symbol + ' holding');
  box.dataset.asset = asset;
  const label = document.createElement('div');
  label.className = 'token';
  const token = tokens.find(token => token.address === asset)!;
  label.append(tokenIcon(token), document.createTextNode(symbol));
  label.title = asset === 'eth' ? 'Native Ethereum' : asset;

  const amount = document.createElement('div');
  amount.className = 'amount';
  amount.textContent = balance.amount === undefined ? '—' : formatBalance(balance.amount, decimals);
  amount.title = balance.amount === undefined ? 'Balance unavailable' : exactBalance(balance.amount, decimals) + ' ' + symbol;
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
    const meaning = explainFailure(failure, config.mode).summary + ' · Details';
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
  price.title = estimate ? '30-minute direct-pool TWAP · ' + estimate.pool + ' · finalized block ' + estimate.blockHash : visiblePriceFailure(balance) || 'Waiting for a qualifying direct pool at the balance’s verified block.';
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
    amount.title = symbol + ': ' + exactBalance(balance.amount!, decimals) + ' · last successful read ' + time.textContent;
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
        if (!tokens.some(asset => tokenBalance(wallet, asset).failed || retryPrice(tokenBalance(wallet, asset), pricing))) retries.cancel(wallet);
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
  const summary = document.querySelector<HTMLElement>('#estimated-total')!;
  const primary = document.createElement('div');
  const label = document.createElement('div'); label.className = 'portfolio-value-label'; label.textContent = 'Portfolio value';
  const value = document.createElement('div'); value.className = 'portfolio-value-amount';
  const number = document.createElement('strong'); number.className = 'portfolio-value-number'; number.textContent = valuationAmount(estimate); number.title = number.textContent;
  const currency = document.createElement('span'); currency.className = 'portfolio-value-currency'; currency.textContent = pricing.quote.symbol;
  value.append(number, document.createTextNode(' '), currency);
  primary.append(label, value);
  const metadata = document.createElement('div'); metadata.className = 'portfolio-value-meta';
  const method = statusIcon('waiting', 'Price methodology', 'Estimated using 30-minute Uniswap v3 TWAPs from direct token/' + pricing.quote.symbol + ' pools at verified finalized blocks. Not a live trading quote.');
  method.querySelector('svg')!.replaceWith(technologyIcon('uniswap', true));
  metadata.append(valuationFlags(estimate), method);
  updateChildren(summary, [primary, metadata]);
  explanationGroup(summary, value.textContent || 'Portfolio value unavailable');
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
    const amount = document.createElement('div');
    amount.className = 'total-amount';
    amount.textContent = total.amount === undefined ? '—' : formatBalance(total.amount, total.decimals);
    amount.title = total.amount === undefined ? 'Balance unavailable' : exactBalance(total.amount, total.decimals) + ' ' + total.symbol;
    const coverage = total.known + '/' + total.addresses + ' addresses';
    let provenance = !total.addresses ? 'Add an address to start'
      : total.known < total.addresses ? 'Partial · ' + coverage : coverage;
    if (total.mixedBlocks) provenance += ' · mixed finalized blocks';
    if (total.stale) provenance += ' · ' + total.stale + ' stale';
    amount.title += ' · ' + provenance;
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
    card.append(label, amounts);
    explanationGroup(card, amount.title + '\n' + quote.title);
    totals.append(card);
  }
  updateChildren(document.querySelector('#totals')!, [...totals.childNodes]);
}
let progressTimer: ReturnType<typeof setInterval> | undefined;
function syncProgressClock() {
  if (!wallets.some(wallet => wallet.loading && !wallet.queuedForVerifier)) { clearInterval(progressTimer); progressTimer = undefined; return; }
  if (progressTimer) return;
  progressTimer = setInterval(() => {
    document.querySelectorAll<HTMLElement>('[data-progress-start]').forEach(clock => {
      clock.textContent = progressTime(Number(clock.dataset.progressStart), Date.now(), clock.dataset.progressDeadline ? Number(clock.dataset.progressDeadline) : undefined);
    });
  }, 1000);
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
    const priceError = visiblePriceFailure(balance);
    if (priceError) { failures.append(failureReport(token.symbol + ' price', balance.priceFailure || { message: errorMessage(priceError), stage: 'Pricing oracle', at: 0 }, new URL(wallet.rpcUrl).hostname, token.address + ':price')); failureCount++; }
  }
  if (wallet.activity.length) {
    const activity = document.createElement('div');
    activity.className = 'activity' + (wallet.loading ? '' : ' is-finished');
    const summary = document.createElement('p');
    summary.textContent = '';
    const retry = retryMessage(wallet);
    if (retry) summary.textContent += ' ' + retry;
    summary.title = summary.textContent;
    activity.hidden = !wallet.loading && !retry;
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
        : item.phase === 'requesting' ? (item.attempt > 1 ? 'Retry ' + (item.attempt - 1) + ' on the same ' + (config.mode === 'https' ? 'HTTPS route' : 'private route') + '; verifying finalized state' : config.mode === 'https' ? 'Verifying locally; fetching HTTPS proofs as needed' : 'Verifying locally; fetching private proofs as needed')
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
  const colgroup = document.createElement('colgroup');
  for (const kind of ['address', 'holdings', 'actions']) {
    const col = document.createElement('col'); col.className = 'wallet-column-' + kind; colgroup.append(col);
  }
  table.append(colgroup);
  const caption = document.createElement('caption');
  caption.className = 'sr-only';
  caption.textContent = 'Token balances by tracked address. Expand a row for timestamps and private request progress.';
  const head = document.createElement('thead');
  const columns = document.createElement('tr');
  for (const entry of ['Address / refresh', 'Holdings', 'Actions']) {
    const column = document.createElement('th');
    column.scope = 'col';
    if (entry === 'Actions') column.setAttribute('aria-label', 'Address details');
    else column.textContent = entry;
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
    const valuation = estimatedTotal([wallet], tokens, pricing);
    const addressValue = document.createElement('div'); addressValue.className = 'address-valuation';
    addressValue.setAttribute('aria-label', 'Estimated address value');
    const value = document.createElement('span'); value.className = 'address-value-estimate';
    value.textContent = valuationAmount(valuation) + ' ' + pricing.quote.symbol;
    addressValue.title = value.textContent + ' · ' + valuation.known + '/' + valuation.count + ' holdings priced';
    addressValue.append(value, valuationFlags(valuation));
    explanationGroup(addressValue, addressValue.title);
    addressLine.append(address, addressValue, refresh);
    identity.append(addressLine);
    {
      const progress = document.createElement('small');
      progress.className = 'verification-progress compact-progress';
      const request = wallet.networkRequests?.[0];
      progress.textContent = request ? (request.purpose || (request.state === 'waiting' ? 'Waiting for ' : 'Receiving ') + request.method) + ' · ' + request.host : stageLabels[wallet.verificationStage || 'connection'];
      if (wallet.checkProgress) progress.textContent = checkLabel(wallet.checkProgress) + ' · ' + progress.textContent;
      progress.title = request ? progress.textContent + ' · ' + request.method + (request.target ? ' · ' + request.target : '') : wallet.verificationStatus || '';
      if (!wallet.loading || wallet.verificationStage === 'connection' || expandedAddresses.has(wallet.address)) { progress.textContent = ''; progress.setAttribute('aria-hidden', 'true'); }
      identity.append(progress);
    }
    row.append(identity);
    const pending = (asset: string) => wallet.loading && wallet.verificationStage !== 'connection' && !wallet.queuedForVerifier && wallet.activity.some(item => item.asset === asset && (item.phase === 'waiting' || item.phase === 'requesting'));
    const holdingsCell = document.createElement('td'); holdingsCell.className = 'wallet-holdings';
    const holdingsContent = document.createElement('div'); holdingsContent.className = 'holdings-content';
    const holdings = document.createElement('div'); holdings.className = 'holdings-list';
    holdings.setAttribute('aria-label', 'Holdings for ' + (wallet.name || wallet.address));
    const visible = visibleHoldings(wallet, assets);
    const holding = (token: Token) => balanceNode(wallet, token.symbol, token.decimals, tokenBalance(wallet, token), pending(token.address), token.address);
    holdings.append(...visible.map(holding));
    explanationGroup(holdings, visible.map(token => { const balance = tokenBalance(wallet, token); return token.symbol + ': ' + (balance.amount === undefined ? 'unavailable' : exactBalance(balance.amount, token.decimals)); }).join('\n'));
    holdingsContent.append(holdings);
    if (!assets.length) {
      const empty = document.createElement('p'); empty.className = 'form-hint'; empty.textContent = 'No tokens tracked.';
      holdingsCell.append(empty);
    }
    holdingsCell.append(holdingsContent);
    row.append(holdingsCell);
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
      const oldTop = walletList.querySelector<HTMLElement>('.wallet[data-address="' + wallet.address + '"] > .balances')!.getBoundingClientRect().top;
      if (expandedAddresses.has(wallet.address)) expandedAddresses.delete(wallet.address);
      else expandedAddresses.add(wallet.address);
      render();
      const newTop = walletList.querySelector<HTMLElement>('.wallet[data-address="' + wallet.address + '"] > .balances')!.getBoundingClientRect().top;
      walletList.scrollTop += newTop - oldTop;
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
      cancelRefresh(wallet);
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
    detailCell.colSpan = 3;
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
const refreshControllers = new Map<Wallet, AbortController>();
const cancelledRefreshes = new Set<Wallet>();
function cancelRefresh(wallet: Wallet) {
  cancelledRefreshes.delete(wallet);
  retries.cancel(wallet);
  wallet.queuedRefresh = false;
  refreshControllers.get(wallet)?.abort(new Error('Address refresh cancelled.'));
}
let pageActive = true;
let refreshGeneration = 0;
async function refreshWallet(wallet: Wallet, onlyFailed = false) {
  if (!pageActive) return;
  const generation = refreshGeneration;
  if (wallet.loading) { if (!onlyFailed) wallet.queuedRefresh = true; return; }
  if (!wallets.includes(wallet)) return;
  if (!tokens.length) { retries.cancel(wallet); wallet.queuedRefresh = false; return; }
  if (onlyFailed) retries.begin(wallet);
  else retries.cancel(wallet);
  if (connection.cancelled) return;
  wallet.queuedRefresh = false;
  const selectedTokens = [...tokens];
  const selectedPricing = structuredClone(pricing);
  const controller = new AbortController();
  refreshControllers.set(wallet, controller);
  wallet.loading = true;
  wallet.verificationStage = 'connection';
  wallet.stageStartedAt = Date.now();
  wallet.networkRequests = [];
  wallet.checkProgress = undefined;
  wallet.queuedForVerifier = false;
  appendRetrievalLog(wallet, (onlyFailed?'Automatic retry':'Refresh')+' started · '+new URL(wallet.rpcUrl).hostname+(config.mode === 'https' ? ' through direct HTTPS (not anonymous).' : ' through the address’s Anon-RPC route.'));
  appendRetrievalLog(wallet, config.mode === 'https' ? 'Using direct HTTPS; RPC providers see your IP and requested addresses.' : state==='ready'?'Using the ready private worker.':connectionMessage);
  prepareActivity(wallet, selectedTokens, onlyFailed, selectedPricing);
  render();
  try {
    if (!navigator.onLine) throw new Error('Offline');
    const worker = await connection.get();
    controller.signal.throwIfAborted();
    appendRetrievalLog(wallet, config.mode === 'https' ? 'HTTPS transport ready; requesting finalized verification.' : 'Private worker ready; requesting finalized verification.');
    if (wallets.includes(wallet)) await readBalances(wallet, worker, selectedTokens, () => { if (!controller.signal.aborted) { pruneTokenBalances(wallet); persist(); render(); } }, onlyFailed, undefined, controller.signal, selectedPricing);
  } catch (cause) {
    if (controller.signal.aborted) return;
    const failure = readFailure(navigator.onLine ? cause : 'Browser is offline.', config.mode === 'https' ? 'Starting the HTTPS connection' : 'Starting the private connection');
    wallet.verificationStatus = failure.message;
    appendRetrievalLog(wallet,'Refresh failed: '+failure.message,'error');
    wallet.activity.forEach(item => {
      const token = selectedTokens.find(token => token.address === item.asset);
      if (token) { tokenBalance(wallet, token).failed = true; tokenBalance(wallet, token).failure = failure; }
      item.phase = 'failed';
    });
  } finally {
    refreshControllers.delete(wallet);
    wallet.loading = false;
    wallet.networkRequests = [];
    wallet.queuedForVerifier = false;
    pruneTokenBalances(wallet);
    persist(); render();
    if (controller.signal.aborted || generation !== refreshGeneration || !pageActive || !wallets.includes(wallet) || connection.cancelled) { retries.cancel(wallet); wallet.queuedRefresh = false; return; }
    const failed = tokens.some(token => tokenBalance(wallet, token).failed || retryPrice(tokenBalance(wallet, token), pricing));
    // An explicit refresh (including changed pricing) covers every holding even
    // when this older attempt failed. Automatic retries remain failure-only.
    if (wallet.queuedRefresh) { void refreshWallet(wallet); }
    else if (failed) retries.schedule(wallet);
    else retries.cancel(wallet);
  }
}
async function start(automatic = false) {
  if (!pageActive) return;
  const resumeCancelled = connection.cancelled;
  if (automatic) retries.begin('connection');
  else retries.cancel('connection');
  if (!navigator.onLine) { state = 'failed'; retries.schedule('connection'); renderConnection(); return; }
  try {
    await connection.get();
    if (resumeCancelled && !automatic) wallets.forEach(wallet => {
      const interrupted = cancelledRefreshes.has(wallet);
      if (!wallet.loading && (interrupted || tokens.some(token => tokenBalance(wallet, token).failed))) {
        cancelledRefreshes.delete(wallet);
        void refreshWallet(wallet, !interrupted);
      }
    });
  }
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
function syncNetworkFields() {
  const tor = document.querySelector<HTMLSelectElement>('#settings-mode')!.value === 'tor';
  document.querySelectorAll<HTMLElement>('[data-tor-only]').forEach(section => { section.hidden = !tor; });
}
document.querySelector('#settings-mode')!.addEventListener('change', syncNetworkFields);
function showSettings(settings: NetworkSettings) {
  stagedWorker = settings.torWorker;
  settingsField('tor-worker').value = stagedWorker ? 'updated' : 'bundled';
  renderWorkerMetadata();
  document.querySelector<HTMLSelectElement>('#settings-mode')!.value = settings.mode || 'tor';
  settingsField('bootstrap-url').value = settings.bootstrapUrl ?? defaultConfig.bootstrapUrl;
  settingsField('gateways').value = settings.gateways.join('\n');
  settingsField('rpcs').value = settings.rpcUrls.join('\n');
  const checkpoint = settings.checkpoint || DEFAULT_CHECKPOINT;
  settingsField('checkpoint-root').value = checkpoint.root;
  settingsField('checkpoint-slot').value = String(checkpoint.slot);
  syncNetworkFields();
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
    const settings = validateSettings({ mode: document.querySelector<HTMLSelectElement>('#settings-mode')!.value, bootstrapUrl: settingsField('bootstrap-url').value.trim(), torWorker: settingsField('tor-worker').value === 'updated' ? stagedWorker : undefined, gateways: lines(settingsField('gateways').value), rpcUrls: lines(settingsField('rpcs').value),
      checkpoint: { root: settingsField('checkpoint-root').value, slot: Number(settingsField('checkpoint-slot').value) } });
    checkCheckpointAge(Date.now(), settings.checkpoint);
    applySettings(settings);
  } catch (cause) {
    const message = (cause as Error).message;
    document.querySelector('#settings-error')!.textContent = message;
    const section = /checkpoint/i.test(message) ? '#checkpoint-settings' : /gateway|directory|mirror/i.test(message) ? '#tor-routing' : undefined;
    if (section) {
      const details = document.querySelector<HTMLDetailsElement>(section)!;
      details.hidden = false; details.open = true;
    }
  }
});
document.querySelector('#reset-settings')!.addEventListener('click', () => {
  showSettings(defaultConfig);
  applySettings(null);
});
function renderOffline() {
  document.querySelector('#offline-notice')!.textContent = navigator.onLine ? ''
    : 'You appear to be offline. Saved wallets, tokens and balances remain available. Failed reads will retry when the connection returns.';
}
subscribeHeliosStatus(renderHeliosStatus);
renderTokens(); render(); renderConnection(); renderOffline();
void start();
window.addEventListener('offline', () => { retries.pause(); renderOffline(); });
window.addEventListener('online', () => { renderOffline(); retries.resume(); if (!connection.cancelled) void start(true); });
window.addEventListener('pagehide', () => {
  pageActive = false;
  refreshGeneration++;
  retries.cancel('connection');
  wallets.forEach(cancelRefresh);
  connection.close();
});
window.addEventListener('pageshow', event => { if (event.persisted) { pageActive = true; if (!connection.cancelled) void start(true); } });
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js' + (config.mode === 'https' ? '?mode=https' : '')).catch(() => {
    document.querySelector('#offline-notice')!.textContent = 'Offline page caching is unavailable. Balances are still saved locally, but reopening the page may need a connection.';
  });
}

const pricingPreset = document.querySelector<HTMLSelectElement>('#pricing-preset')!;
const quoteAddress = document.querySelector<HTMLInputElement>('#pricing-address')!;
const quoteSymbol = document.querySelector<HTMLInputElement>('#pricing-symbol')!;
const quoteDecimals = document.querySelector<HTMLInputElement>('#pricing-decimals')!;
const quoteLiquidity = document.querySelector<HTMLInputElement>('#pricing-liquidity')!;
function showPricingSettings() {
  const presetQuote = defaultPricing().quote;
  pricingPreset.value = pricing.quote.address === presetQuote.address && pricing.quote.decimals === presetQuote.decimals && pricing.quote.symbol === presetQuote.symbol ? 'usdc' : 'custom';
  quoteAddress.value = pricing.quote.address; quoteSymbol.value = pricing.quote.symbol;
  quoteDecimals.value = String(pricing.quote.decimals); quoteLiquidity.value = pricing.minLiquidity;
  showPricingCustom();
}
function adoptPricing(next: PricingSettings) {
  pricing = next;
  // Storage events update the view without starting requests in another tab.
  for (const wallet of wallets) {
    for (const token of tokens) {
      const balance = tokenBalance(wallet, token);
      if (!usableEstimate(balance, pricing)) delete balance.estimate;
      if (balance.priceFailure?.settingsKey !== pricingSettingsKey(pricing)) { delete balance.priceError; delete balance.priceFailure; }
    }
    if (!tokens.some(token => tokenBalance(wallet, token).failed || retryPrice(tokenBalance(wallet, token), pricing))) retries.cancel(wallet);
  }
}
function showPricingCustom() { document.querySelector<HTMLElement>('#pricing-custom')!.hidden = pricingPreset.value !== 'custom'; }
pricingPreset.onchange = showPricingCustom; showPricingSettings();
document.querySelector('#pricing-form')!.addEventListener('submit', event => {
  event.preventDefault();
  const error = document.querySelector('#pricing-error')!;
  try {
    const next = validatePricing({ quote: pricingPreset.value === 'usdc' ? defaultPricing().quote : { address: quoteAddress.value, symbol: quoteSymbol.value, decimals: Number(quoteDecimals.value) }, minLiquidity: quoteLiquidity.value });
    if (!savePricing(next)) throw new Error('Browser storage unavailable; pricing settings were not changed.');
    adoptPricing(next);
    error.textContent = ''; persist(); render(); closeSettings();
    wallets.forEach(wallet => { void refreshWallet(wallet); });
  } catch (cause) { error.textContent = (cause as Error).message; }
});
