import { config } from './config';
import { Connection, type ConnectionState } from './connection';
import { formatBalance, makeWallet, prepareActivity, readBalances, tokenBalance, type Balance, type Wallet } from './balances';
import { loadPortfolio, savePortfolio } from './storage';
import { parseWalletList, validateToken, wethToken, type Token } from './tokens';
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<header><a class="brand" href="./" aria-label="Anonfolio home"><span class="brand-mark">a</span>anonfolio<span class="brand-dot">.</span></a><span class="network"><i></i>Ethereum mainnet</span></header>
<main><div class="eyebrow">YOUR WALLETS. YOUR BUSINESS.</div>
<h1>A little less public.</h1><p class="intro">Keep an eye on your ETH and tokens.<br>Read balances through Tor, with a private route for every wallet.</p>
<form id="wallet-form" novalidate>
<label for="address">Ethereum wallet addresses</label>
<div class="input-row"><textarea id="address" name="address" rows="2" placeholder="0x… Paste one address or a list" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="wallet-hint input-error" required></textarea><button class="primary" type="submit">Add wallet <span aria-hidden="true">↗</span></button></div>
<p class="form-hint" id="wallet-hint">One address per line, or separate addresses with commas. Each wallet has its own refresh.</p>
<p id="input-error" class="input-error" role="alert"></p><p id="wallet-notice" class="form-hint" role="status"></p></form>
<details class="token-settings"><summary>Tracked tokens <span id="token-count"></span></summary>
<p class="form-hint">ETH and WETH are included. Add a mainnet ERC-20 to track it across every wallet.</p>
<ul id="token-list" aria-label="Tracked tokens"></ul>
<form id="token-form" novalidate><div class="token-inputs">
<div><label for="token-address">Token contract address</label><input id="token-address" placeholder="0x…" autocomplete="off" spellcheck="false" aria-describedby="token-error"></div>
<div><label for="token-symbol">Symbol</label><input id="token-symbol" placeholder="USDC" maxlength="16" autocomplete="off" aria-describedby="token-error"></div>
<div><label for="token-decimals">Decimals</label><input id="token-decimals" type="number" min="0" max="255" step="1" value="18" aria-describedby="token-error"></div></div>
<p class="form-hint">Use the token's actual symbol and decimals (for example, USDC uses 6). You supply these display settings; adding a token sends only balanceOf reads, never approvals or transactions.</p>
<button type="submit">Add token</button><p id="token-error" class="input-error" role="alert"></p></form></details>
<div class="section-heading"><h2>Watchlist <span id="count">0</span></h2><span class="local-note">Wallets, tokens & balances saved locally</span></div>
<div id="connection" role="status" aria-live="polite"></div>
<p id="offline-notice" role="status"></p><p id="storage-warning" role="status"></p>
<section id="wallets" aria-label="Watched wallets"></section>
<aside class="privacy-note"><span aria-hidden="true">⌁</span><div><strong>A private path to public balances.</strong><p>Wallet reads travel through Anon-RPC and Tor. No wallet connection, no analytics, no addresses in URLs. The RPC operator still sees the address it reads. Saved balances may be out of date.</p></div></aside>
</main><footer><span>anonfolio / balance reader</span><span>Ethereum mainnet · Latest RPC state</span></footer>`;

let state: ConnectionState = 'starting';
let connectionMessage = 'Preparing public worker discovery. Wallet balance requests wait for the private worker.';
const { wallets, tokens } = loadPortfolio(config.rpcUrls);
const walletList = document.querySelector<HTMLElement>('#wallets')!;
const input = document.querySelector<HTMLTextAreaElement>('#address')!;
const error = document.querySelector<HTMLElement>('#input-error')!;
const connection = new Connection(
  next => { state = next; renderConnection(); },
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
function renderConnection() {
  const node = document.querySelector<HTMLElement>('#connection')!;
  node.className = 'connection ' + state;
  node.replaceChildren();
  if (state === 'starting') node.append(spinner());
  const text = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = state === 'ready' ? 'Private worker ready · separate route per wallet'
    : state === 'starting' ? 'Starting private connection…'
    : 'Private connection unavailable. Wallet reads will only use the private route.';
  const detail = document.createElement('p');
  detail.className = 'connection-detail';
  detail.textContent = state === 'starting' ? connectionMessage
    : state === 'ready' ? 'Balance requests go to the RPC operator listed on each wallet. Worker readiness does not guarantee that every Tor route or operator is reachable.'
    : 'No direct fallback was used. Saved balances remain visible. Retry the connection, then refresh the wallets you want.';
  const gateway = document.createElement('p');
  gateway.className = 'connection-detail';
  gateway.textContent = 'Configured Tor gateway(s): ' + config.gateways.map(entry => entry.split(':').slice(0, 2).join(':')).join(', ')
    + '. The worker manages gateway connections and circuits; their live progress is not exposed by the harness.';
  text.append(title, detail, gateway);
  node.append(text);
  if (state === 'failed') {
    const button = document.createElement('button');
    button.textContent = 'Retry connection';
    button.onclick = () => { void start(); };
    node.append(button);
  }
}
function balanceNode(symbol: string, decimals: number, balance: Balance, pending: boolean) {
  const box = document.createElement('div');
  box.className = 'balance';
  const label = document.createElement('div');
  label.className = 'token';
  label.textContent = symbol;
  if (pending) label.append(spinner());
  const amount = document.createElement('div');
  amount.className = 'amount';
  amount.textContent = balance.amount === undefined ? '—' : formatBalance(balance.amount, decimals);
  const status = document.createElement('small');
  status.className = balance.failed ? 'error' : balance.cached ? 'cached' : '';
  status.textContent = balance.failed ? (balance.amount === undefined ? 'Lookup failed · retry available' : 'Stale · refresh failed')
    : balance.cached ? 'Saved balance · stale until refreshed' : balance.updatedAt ? 'Latest successful read' : 'Awaiting first read';
  box.append(label, amount, status);
  if (balance.updatedAt) {
    const time = document.createElement('time');
    time.dateTime = new Date(balance.updatedAt).toISOString();
    time.textContent = new Date(balance.updatedAt).toLocaleString();
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
function render() {
  document.querySelector('#count')!.textContent = String(wallets.length);
  const focus = document.activeElement?.getAttribute('aria-label');
  walletList.replaceChildren();
  if (!wallets.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<span class="empty-icon" aria-hidden="true">◇</span><h3>Your watchlist starts here</h3><p>Add an Ethereum address or a list to read its balances.</p>';
    walletList.append(empty);
  }
  wallets.forEach((wallet, i) => {
    const card = document.createElement('article');
    card.className = 'wallet';
    card.dataset.loading = String(wallet.loading);
    const head = document.createElement('div');
    head.className = 'wallet-head';
    const identity = document.createElement('div');
    const label = document.createElement('small');
    label.className = 'wallet-label';
    label.textContent = 'WALLET ' + String(i + 1).padStart(2, '0');
    const address = document.createElement('div');
    address.className = 'wallet-address';
    address.textContent = wallet.address;
    identity.append(label, address);
    const actions = document.createElement('div');
    actions.className = 'actions';
    const refresh = document.createElement('button');
    refresh.textContent = wallet.loading ? 'Reading…' : [wallet.eth, wallet.weth, ...Object.values(wallet.tokens)].some(b => b.failed) ? 'Retry' : 'Refresh';
    if (wallet.loading) refresh.prepend(spinner());
    refresh.disabled = wallet.loading;
    refresh.setAttribute('aria-label', (wallet.loading ? 'Reading ' : 'Refresh ') + wallet.address);
    refresh.onclick = () => { void refreshWallet(wallet); };
    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Remove ' + wallet.address);
    remove.onclick = () => { wallets.splice(wallets.indexOf(wallet), 1); persist(); render(); };
    actions.append(refresh, remove);
    head.append(identity, actions);
    const amounts = document.createElement('div');
    amounts.className = 'balances';
    amounts.setAttribute('aria-busy', String(wallet.loading));
    const pending = (asset: string) => wallet.loading && wallet.activity.some(item => item.asset === asset && (item.phase === 'waiting' || item.phase === 'requesting'));
    amounts.append(balanceNode('ETH', 18, wallet.eth, pending('eth')),
      ...[wethToken, ...tokens].map(token => balanceNode(token.symbol, token.decimals, tokenBalance(wallet, token), pending(token.address))));
    const route = document.createElement('div');
    route.className = 'route';
    route.textContent = 'Private RPC operator: ' + new URL(wallet.rpcUrl).hostname + ' · wallet-specific Tor isolation';
    card.append(head, amounts, route);
    if (wallet.activity.length) {
      const activity = document.createElement('div');
      activity.className = 'activity';
      activity.setAttribute('role', 'status');
      activity.setAttribute('aria-live', 'polite');
      const summary = document.createElement('p');
      const finished = wallet.activity.filter(item => item.phase === 'received' || item.phase === 'failed').length;
      summary.textContent = wallet.loading ? (finished + '/' + wallet.activity.length + ' reads finished · ' + (wallet.activity.some(item => item.attempt > 0) ? 'Waiting for private RPC responses.' : 'Waiting for the private worker; balance calls have not been submitted yet.'))
        : finished + '/' + wallet.activity.length + ' reads finished. Each amount shows its own result and last successful time.';
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
      card.append(activity);
    }
    walletList.append(card);
  });
  if (focus) [...walletList.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === focus)?.focus({ preventScroll: true });
}
function pruneTokenBalances(wallet: Wallet) {
  for (const address of Object.keys(wallet.tokens)) {
    if (!tokens.some(token => token.address === address)) delete wallet.tokens[address];
  }
}
async function refreshWallet(wallet: Wallet) {
  if (wallet.loading) { wallet.queuedRefresh = true; return; }
  if (!wallets.includes(wallet)) return;
  const selectedTokens = [...tokens];
  wallet.loading = true;
  prepareActivity(wallet, selectedTokens);
  render();
  try {
    if (!navigator.onLine) throw new Error('Offline');
    const worker = await connection.get();
    if (wallets.includes(wallet)) await readBalances(wallet, worker, selectedTokens, () => { pruneTokenBalances(wallet); persist(); render(); });
  } catch {
    wallet.eth.failed = wallet.weth.failed = true;
    selectedTokens.forEach(token => { tokenBalance(wallet, token).failed = true; });
    wallet.activity.forEach(item => { item.phase = 'failed'; });
  } finally {
    wallet.loading = false;
    pruneTokenBalances(wallet);
    persist(); render();
    if (wallet.queuedRefresh) { wallet.queuedRefresh = false; void refreshWallet(wallet); }
  }
}
async function start() {
  if (!navigator.onLine) { state = 'failed'; renderConnection(); return; }
  try { await connection.get(); } catch { /* connection status provides retry */ }
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
    : 'You appear to be offline. Saved wallets, tokens and balances remain available; the timestamps show when they were last read.';
}
renderTokens(); render(); renderConnection(); renderOffline();
void start();
wallets.forEach(wallet => { void refreshWallet(wallet); });
window.addEventListener('offline', renderOffline);
window.addEventListener('online', () => { renderOffline(); void start(); });
window.addEventListener('pagehide', () => connection.close());
window.addEventListener('pageshow', event => { if (event.persisted) void start(); });
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {
    document.querySelector('#offline-notice')!.textContent = 'Offline page caching is unavailable. Balances are still saved locally, but reopening the page may need a connection.';
  });
}
