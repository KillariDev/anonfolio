import { config } from './config';
import { Connection, type ConnectionState } from './connection';
import { formatBalance, makeWallet, prepareActivity, readBalances, tokenBalance, type Balance, type Wallet } from './balances';
import { loadPortfolio, savePortfolio } from './storage';
import { parseWalletList, validateToken, wethToken, type Token } from './tokens';
import { RetryQueue } from './retries';
import { portfolioTotals } from './totals';
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<header><a class="brand" href="./" aria-label="Anonfolio home"><span class="brand-mark">a</span>anonfolio<span class="brand-dot">.</span></a><span class="network"><i></i>Ethereum mainnet</span></header>
<main>
<div class="page-heading"><h1>Portfolio</h1><span class="local-note">Ethereum balances · saved on this browser</span></div>
<section class="overview" aria-label="Portfolio token totals">
<div class="overview-heading"><h2>Token totals</h2><span id="total-count"></span></div>
<div id="totals" class="totals" aria-live="polite"></div></section>
<div class="controls">
<details id="address-panel" class="address-settings"><summary>Add addresses</summary>
<form id="wallet-form" novalidate>
<label for="address">Ethereum wallet addresses</label>
<div class="input-row"><textarea id="address" name="address" rows="2" placeholder="0x… Paste one address or a list" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="wallet-hint input-error" required></textarea><button class="primary" type="submit">add address to track <span aria-hidden="true">↗</span></button></div>
<p class="form-hint" id="wallet-hint">One address per line, or separate addresses with commas. Each wallet has its own refresh.</p>
<p id="input-error" class="input-error" role="alert"></p><p id="wallet-notice" class="form-hint" role="status"></p></form></details>
<details class="token-settings"><summary>Tracked tokens <span id="token-count"></span></summary>
<p class="form-hint">ETH and WETH are included. Add a mainnet ERC-20 to track it across every wallet.</p>
<ul id="token-list" aria-label="Tracked tokens"></ul>
<form id="token-form" novalidate><div class="token-inputs">
<div><label for="token-address">Token contract address</label><input id="token-address" placeholder="0x…" autocomplete="off" spellcheck="false" aria-describedby="token-error"></div>
<div><label for="token-symbol">Symbol</label><input id="token-symbol" placeholder="USDC" maxlength="16" autocomplete="off" aria-describedby="token-error"></div>
<div><label for="token-decimals">Decimals</label><input id="token-decimals" type="number" min="0" max="255" step="1" value="18" aria-describedby="token-error"></div></div>
<p class="form-hint">Use the token's actual symbol and decimals (for example, USDC uses 6). You supply these display settings; adding a token sends only balanceOf reads, never approvals or transactions.</p>
<button type="submit">Add token</button><p id="token-error" class="input-error" role="alert"></p></form></details>
</div>
<details id="connection" aria-label="Private connection details"></details>
<p id="offline-notice" role="status"></p><p id="storage-warning" role="status"></p>
<div class="section-heading"><h2>Addresses <span id="count">0</span></h2><span class="local-note">Expand a row for request details</span></div>
<p class="scroll-hint">Swipe the table to see more tokens and controls.</p>
<section id="wallets" aria-label="Watched wallets"></section>
</main><footer><span>anonfolio / balance reader</span><span>Ethereum mainnet · Latest RPC state</span></footer>`;

let state: ConnectionState = 'starting';
let connectionMessage = 'Preparing public worker discovery. Wallet balance requests wait for the private worker.';
const { wallets, tokens } = loadPortfolio(config.rpcUrls);
const walletList = document.querySelector<HTMLElement>('#wallets')!;
walletList.tabIndex = 0;
const addressPanel = document.querySelector<HTMLDetailsElement>('#address-panel')!;
addressPanel.open = wallets.length === 0;
const expandedAddresses = new Set<string>();
const input = document.querySelector<HTMLTextAreaElement>('#address')!;
const error = document.querySelector<HTMLElement>('#input-error')!;
const retries = new RetryQueue<Wallet | 'connection'>(
  key => key === 'connection' ? start(true) : refreshWallet(key, true),
  () => navigator.onLine,
  () => { renderConnection(); render(); },
);
const connection = new Connection(
  next => {
    state = next;
    if (next === 'failed') retries.schedule('connection');
    else if (next === 'ready') retries.cancel('connection');
    renderConnection();
  },
  message => { connectionMessage = message; renderConnection(); },
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
  node.replaceChildren();
  const heading = document.createElement('summary');
  if (state === 'starting') heading.append(spinner());
  const text = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = state === 'ready' ? 'Private worker ready'
    : state === 'starting' ? 'Starting private connection…'
    : 'Private connection unavailable';
  heading.append(title);
  const current = document.createElement('span');
  current.className = 'connection-current';
  current.textContent = state === 'starting' ? connectionMessage : state === 'failed' ? retryMessage('connection') : 'Separate private route per address';
  current.title = current.textContent;
  heading.append(current);
  node.append(heading);
  const detail = document.createElement('p');
  detail.className = 'connection-detail';
  detail.textContent = state === 'starting' ? connectionMessage
    : state === 'ready' ? 'Balance requests go to the RPC operator listed on each wallet. Worker readiness does not guarantee that every Tor route or operator is reachable.'
    : 'Saved balances remain visible. ' + retryMessage('connection');
  const gateway = document.createElement('p');
  gateway.className = 'connection-detail';
  gateway.textContent = 'Configured Tor gateway(s): ' + config.gateways.map(entry => entry.split(':').slice(0, 2).join(':')).join(', ')
    + '. The worker manages gateway connections and circuits; their live progress is not exposed by the harness.';
  text.append(detail, gateway);
  node.append(text);
  if (state === 'failed') {
    const button = document.createElement('button');
    button.textContent = 'Retry connection';
    button.onclick = event => { event.preventDefault(); event.stopPropagation(); void start(); };
    heading.append(button);
  }
}
function balanceNode(symbol: string, decimals: number, balance: Balance, pending: boolean) {
  const box = document.createElement('td');
  box.className = 'balance';
  const label = document.createElement('div');
  label.className = 'token';
  label.textContent = symbol;

  const amount = document.createElement('div');
  amount.className = 'amount';
  amount.textContent = balance.amount === undefined ? '—' : formatBalance(balance.amount, decimals);
  if (pending) amount.prepend(spinner());
  const status = document.createElement('small');
  status.className = balance.failed ? 'error' : balance.cached ? 'cached' : '';
  status.textContent = balance.failed ? (balance.amount === undefined ? 'Lookup failed · retry available' : 'Stale · refresh failed')
    : balance.cached ? 'Saved balance · stale until refreshed' : balance.updatedAt ? 'Latest successful read' : 'Awaiting first read';
  box.append(label, amount, status);
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
  document.querySelector('#token-count')!.textContent = '(' + (tokens.length + 2) + ')';
  for (const token of [{ symbol: 'ETH', address: undefined, decimals: 18 }, wethToken, ...tokens]) {
    const item = document.createElement('li');
    const text = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = token.symbol + ' · ' + token.decimals + ' decimals';
    const address = document.createElement('small');
    address.textContent = token.address || 'Native Ethereum balance';
    text.append(name, address);
    item.append(text);
    if (token.address && token.address !== wethToken.address) {
      const remove = document.createElement('button');
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove token ' + token.symbol);
      remove.onclick = () => {
        tokens.splice(tokens.findIndex(t => t.address === token.address), 1);
        wallets.forEach(wallet => { delete wallet.tokens[token.address!]; });
        persist(); renderTokens(); render();
      };
      item.append(remove);
    }
    list.append(item);
  }
}
function renderTotals() {
  const totals = document.querySelector('#totals')!;
  totals.replaceChildren();
  document.querySelector('#total-count')!.textContent = wallets.length + ' tracked address' + (wallets.length === 1 ? '' : 'es');
  for (const total of portfolioTotals(wallets, tokens)) {
    const card = document.createElement('article');
    card.className = 'total';
    card.dataset.asset = total.id;
    card.setAttribute('aria-label', total.symbol + ' total' + (total.address ? ' · ' + total.address : ''));
    const label = document.createElement('div');
    label.className = 'total-label';
    label.textContent = total.symbol;
    label.title = total.address || 'Native Ethereum';
    if (total.loading) label.append(spinner());
    const amount = document.createElement('div');
    amount.className = 'total-amount';
    amount.textContent = total.amount === undefined ? '—' : formatBalance(total.amount, total.decimals);
    const status = document.createElement('small');
    status.className = 'total-status';
    const coverage = total.known + '/' + total.addresses + ' addresses';
    status.textContent = !total.addresses ? 'Add an address to start'
      : total.known < total.addresses ? 'Partial · ' + coverage : coverage;
    if (total.stale) status.textContent += ' · ' + total.stale + ' stale';
    if (total.loading) status.textContent += ' · updating';
    card.classList.toggle('incomplete', total.known < total.addresses || total.stale > 0);
    card.append(label, amount, status);
    totals.append(card);
  }
}
function walletDetails(wallet: Wallet) {
  const content = document.createElement('div');
  content.className = 'detail-inner';
  const fullAddress = document.createElement('div');
  fullAddress.className = 'full-address';
  fullAddress.textContent = wallet.address;
  const route = document.createElement('div');
  route.className = 'route';
  route.textContent = 'Private RPC operator: ' + new URL(wallet.rpcUrl).hostname + ' · wallet-specific Tor isolation';
  const timestamps = document.createElement('p');
  timestamps.className = 'detail-times';
  timestamps.textContent = [
    { symbol: 'ETH', balance: wallet.eth },
    ...[wethToken, ...tokens].map(token => ({ symbol: token.symbol, balance: tokenBalance(wallet, token) })),
  ].map(({ symbol, balance }) => symbol + ': ' + (balance.updatedAt
    ? 'last read ' + new Date(balance.updatedAt).toLocaleString() : 'not read yet')).join(' · ');
  content.append(fullAddress, route, timestamps);
  if (wallet.activity.length) {
    const activity = document.createElement('div');
    activity.className = 'activity';
    const summary = document.createElement('p');
    const finished = wallet.activity.filter(item => item.phase === 'received' || item.phase === 'failed').length;
    summary.textContent = wallet.loading ? (finished + '/' + wallet.activity.length + ' reads finished · ' + (wallet.activity.some(item => item.attempt > 0) ? 'Waiting for private RPC responses.' : 'Waiting for the private worker; balance calls have not been submitted yet.'))
      : finished + '/' + wallet.activity.length + ' reads finished. Each amount shows its own result and last successful time.';
    const retry = retryMessage(wallet);
    if (retry) summary.textContent += ' ' + retry;
    activity.append(summary);
    wallet.activity.filter(item => item.asset === 'eth' || item.asset === wethToken.address || tokens.some(token => token.address === item.asset)).forEach(item => {
      const line = document.createElement('div');
      line.className = 'activity-item ' + item.phase;
      if (item.phase === 'waiting' || item.phase === 'requesting') line.append(spinner());
      const detail = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = item.symbol + ' · ' + (item.phase === 'waiting' ? 'Waiting for private connection'
        : item.phase === 'requesting' ? (item.attempt > 1 ? 'Retry ' + (item.attempt - 1) + ' submitted on the same private route; waiting for response' : 'Submitted to private worker; waiting for response')
        : item.phase === 'received' ? 'Balance received' : 'Read failed; previous amount kept if available');
      const payload = document.createElement('small');
      payload.textContent = item.description + ' · wallet ' + wallet.address + ' → ' + new URL(wallet.rpcUrl).hostname;
      detail.append(title, payload);
      line.append(detail);
      activity.append(line);
    });
    content.append(activity);
  }
  return content;
}
function render() {
  renderTotals();
  document.querySelector('#count')!.textContent = String(wallets.length);
  const focus = document.activeElement?.getAttribute('aria-label');
  const scrollLeft = walletList.scrollLeft;
  const scrollTop = walletList.scrollTop;
  walletList.replaceChildren();
  if (!wallets.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<h3>Your watchlist starts here</h3><p>Add an Ethereum address or a list to read its balances.</p>';
    walletList.append(empty);
    return;
  }
  const assets = [wethToken, ...tokens];
  const table = document.createElement('table');
  table.className = 'wallet-table';
  table.style.minWidth = (460 + (assets.length + 1) * 170) + 'px';
  const caption = document.createElement('caption');
  caption.className = 'sr-only';
  caption.textContent = 'Token balances by tracked address. Use Details for full addresses, timestamps and private request progress.';
  const head = document.createElement('thead');
  const columns = document.createElement('tr');
  for (const [index, text] of ['Address / refresh', 'ETH', ...assets.map(token => token.symbol), 'Status', 'Actions'].entries()) {
    const column = document.createElement('th');
    column.scope = 'col';
    column.textContent = text;
    if (index === 1) column.title = 'Native Ethereum';
    else if (index > 1 && index <= assets.length + 1) column.title = assets[index - 2]!.address;
    columns.append(column);
  }
  head.append(columns);
  table.append(caption, head);
  wallets.forEach(wallet => {
    const card = document.createElement('tbody');
    card.className = 'wallet';
    card.dataset.loading = String(wallet.loading);
    const row = document.createElement('tr');
    row.className = 'balances';
    row.setAttribute('aria-busy', String(wallet.loading));
    const identity = document.createElement('th');
    identity.scope = 'row';
    identity.className = 'wallet-head';
    const address = document.createElement('span');
    address.className = 'wallet-address sr-only';
    address.textContent = wallet.address;
    const short = document.createElement('span');
    short.className = 'address-short';
    short.setAttribute('aria-hidden', 'true');
    short.textContent = wallet.address.slice(0, 8) + '…' + wallet.address.slice(-6);
    short.title = wallet.address;
    const refresh = document.createElement('button');
    refresh.className = 'refresh-icon';
    refresh.textContent = wallet.loading ? '' : '↻';
    if (wallet.loading) refresh.append(spinner());
    refresh.disabled = wallet.loading;
    refresh.title = wallet.loading ? 'Reading balances' : 'Refresh this address';
    refresh.setAttribute('aria-label', (wallet.loading ? 'Reading ' : 'Refresh ') + wallet.address);
    refresh.onclick = () => { void refreshWallet(wallet); };
    const addressLine = document.createElement('div');
    addressLine.className = 'address-line';
    addressLine.append(address, short, refresh);
    identity.append(addressLine);
    row.append(identity);
    const pending = (asset: string) => wallet.loading && wallet.activity.some(item => item.asset === asset && (item.phase === 'waiting' || item.phase === 'requesting'));
    row.append(balanceNode('ETH', 18, wallet.eth, pending('eth')),
      ...assets.map(token => balanceNode(token.symbol, token.decimals, tokenBalance(wallet, token), pending(token.address))));
    const status = document.createElement('td');
    status.className = 'row-status';
    status.setAttribute('aria-live', 'polite');
    const values = [wallet.eth, ...assets.map(token => tokenBalance(wallet, token))];
    const failed = values.some(balance => balance.failed);
    const cached = values.some(balance => balance.cached);
    const known = values.filter(balance => balance.amount !== undefined).length;
    const retry = retries.info(wallet);
    status.textContent = wallet.loading ? 'Reading ' + wallet.activity.filter(item => item.phase === 'received' || item.phase === 'failed').length + '/' + wallet.activity.length
      : retry ? (retry.dueAt ? 'Retry ' + new Date(retry.dueAt).toLocaleTimeString() : 'Retry paused')
      : failed ? 'Read failed' : known < values.length ? 'Partial' : cached ? 'Saved' : 'Current';
    status.title = retryMessage(wallet) || (failed ? 'Some reads failed; previous amounts are retained' : 'Expand Details for read timestamps');
    status.classList.toggle('warning', failed || cached || known < values.length);
    const actions = document.createElement('td');
    actions.className = 'actions';
    const expanded = expandedAddresses.has(wallet.address);
    const toggle = document.createElement('button');
    toggle.textContent = expanded ? 'Close' : 'Details';
    toggle.setAttribute('aria-label', 'Details ' + wallet.address);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-controls', 'details-' + wallet.address);
    toggle.onclick = () => {
      if (expandedAddresses.has(wallet.address)) expandedAddresses.delete(wallet.address);
      else expandedAddresses.add(wallet.address);
      render();
    };
    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.textContent = '×';
    remove.title = 'Remove address';
    remove.setAttribute('aria-label', 'Remove ' + wallet.address);
    remove.onclick = () => {
      retries.cancel(wallet);
      expandedAddresses.delete(wallet.address);
      wallets.splice(wallets.indexOf(wallet), 1);
      persist(); render();
    };
    actions.append(toggle, remove);
    row.append(status, actions);
    const details = document.createElement('tr');
    details.id = 'details-' + wallet.address;
    details.className = 'wallet-details';
    details.hidden = !expanded;
    const detailCell = document.createElement('td');
    detailCell.colSpan = assets.length + 4;
    detailCell.append(walletDetails(wallet));
    details.append(detailCell);
    card.append(row, details);
    table.append(card);
  });
  walletList.append(table);
  walletList.scrollLeft = scrollLeft;
  walletList.scrollTop = scrollTop;
  if (focus) [...walletList.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === focus)?.focus({ preventScroll: true });
}
function pruneTokenBalances(wallet: Wallet) {
  for (const address of Object.keys(wallet.tokens)) {
    if (!tokens.some(token => token.address === address)) delete wallet.tokens[address];
  }
}
async function refreshWallet(wallet: Wallet, onlyFailed = false) {
  if (wallet.loading) { wallet.queuedRefresh = true; return; }
  if (!wallets.includes(wallet)) return;
  if (onlyFailed) retries.begin(wallet);
  else retries.cancel(wallet);
  const selectedTokens = [...tokens];
  wallet.loading = true;
  prepareActivity(wallet, selectedTokens, onlyFailed);
  render();
  try {
    if (!navigator.onLine) throw new Error('Offline');
    const worker = await connection.get();
    if (wallets.includes(wallet)) await readBalances(wallet, worker, selectedTokens, () => { pruneTokenBalances(wallet); persist(); render(); }, onlyFailed);
  } catch {
    wallet.activity.forEach(item => {
      if (item.asset === 'eth') wallet.eth.failed = true;
      else {
        const token = [wethToken, ...selectedTokens].find(token => token.address === item.asset);
        if (token) tokenBalance(wallet, token).failed = true;
      }
      item.phase = 'failed';
    });
  } finally {
    wallet.loading = false;
    pruneTokenBalances(wallet);
    persist(); render();
    if (!wallets.includes(wallet)) { retries.cancel(wallet); return; }
    if (wallet.queuedRefresh) { wallet.queuedRefresh = false; void refreshWallet(wallet); }
    else if ([wallet.eth, wallet.weth, ...Object.values(wallet.tokens)].some(balance => balance.failed)) retries.schedule(wallet);
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
  try { addresses = parseWalletList(input.value); }
  catch (cause) {
    error.textContent = (cause as Error).message;
    input.setAttribute('aria-invalid', 'true');
    return;
  }
  const additions = addresses.filter(address => !wallets.some(wallet => wallet.address === address));
  if (!additions.length) { error.textContent = 'This wallet is already on your watchlist.'; return; }
  input.removeAttribute('aria-invalid');
  error.textContent = '';
  const added: Wallet[] = [];
  for (const address of additions) {
    const used = new Set(wallets.map(wallet => wallet.rpcUrl));
    const rpc = config.rpcUrls.find(url => !used.has(url)) || config.rpcUrls[wallets.length % config.rpcUrls.length]!;
    const wallet = makeWallet(address, rpc);
    wallets.push(wallet); added.push(wallet);
  }
  persist();
  document.querySelector('#wallet-notice')!.textContent = 'Added ' + added.length + ' wallet' + (added.length === 1 ? '' : 's') + '. Existing entries were skipped.';
  input.value = '';
  addressPanel.open = false;
  document.querySelector<HTMLDetailsElement>('.token-settings')!.open = false;
  added.forEach(wallet => { void refreshWallet(wallet); });
});
document.querySelector('#token-form')!.addEventListener('submit', event => {
  event.preventDefault();
  const tokenError = document.querySelector('#token-error')!;
  const field = (id: string) => document.querySelector<HTMLInputElement>('#' + id)!;
  let token: Token;
  try {
    token = validateToken(field('token-address').value, field('token-symbol').value, field('token-decimals').value);
    if (tokens.some(t => t.address === token.address)) throw new Error('This token is already tracked.');
  } catch (cause) { tokenError.textContent = (cause as Error).message; return; }
  tokens.push(token);
  tokenError.textContent = '';
  field('token-address').value = field('token-symbol').value = '';
  field('token-decimals').value = '18';
  persist(); renderTokens(); render();
  wallets.forEach(wallet => { void refreshWallet(wallet); });
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
