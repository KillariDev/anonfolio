import { getAddress, isAddress } from 'viem';
import { config } from './config';
import { Connection, type ConnectionState } from './connection';
import { formatBalance, makeWallet, readBalances, type Balance, type Wallet } from './balances';
import { loadAddresses, saveAddresses } from './storage';
import './style.css';

const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `
  <header><a class="brand" href="./" aria-label="Anonfolio home"><span class="brand-mark">a</span>anonfolio<span class="brand-dot">.</span></a><span class="network"><i></i>Ethereum mainnet</span></header>
  <main><div class="eyebrow">YOUR WALLETS. YOUR BUSINESS.</div>
  <h1>A little less public.</h1><p class="intro">Keep an eye on your ETH and WETH.<br>Read balances through Tor, with a private route for every wallet.</p>
  <form id="wallet-form" novalidate><label for="address">Ethereum address</label><div class="input-row"><input id="address" name="address" placeholder="0x…" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="input-error" required><button class="primary" type="submit">Add wallet <span aria-hidden="true">↗</span></button></div><p id="input-error" class="input-error" role="alert"></p></form>
  <div class="section-heading"><h2>Watchlist <span id="count">0</span></h2><span class="local-note">Saved on this browser only</span></div>
  <div id="connection" role="status" aria-live="polite"></div>
  <p id="storage-warning" role="status"></p>
  <section id="wallets" aria-label="Watched wallets"></section>
  <aside class="privacy-note"><span aria-hidden="true">⌁</span><div><strong>A private path to public balances.</strong><p>Wallet reads travel through Anon-RPC and Tor. No wallet connection, no analytics, no addresses in URLs. The RPC operator still sees the address it reads.</p></div></aside>
  </main><footer><span>anonfolio / balance reader</span><span>ETH + WETH · Latest RPC state</span></footer>`;

let state: ConnectionState = 'starting';
const wallets: Wallet[] = loadAddresses().map((address, i) => makeWallet(address, config.rpcUrls[i % config.rpcUrls.length]!));
const connection = new Connection((next) => { state = next; renderConnection(); });
const walletList = document.querySelector<HTMLElement>('#wallets')!;
const input = document.querySelector<HTMLInputElement>('#address')!;
const error = document.querySelector<HTMLElement>('#input-error')!;
const persist = () => {
  document.querySelector('#storage-warning')!.textContent = saveAddresses(wallets.map(w => w.address))
    ? '' : 'Browser storage is unavailable. This watchlist will be lost when you leave.';
};
function renderConnection() {
  const node = document.querySelector<HTMLElement>('#connection')!;
  node.className = 'connection ' + state;
  node.replaceChildren();
  const text = document.createElement('span');
  text.textContent = state === 'ready' ? 'Private worker ready · separate route per wallet'
    : state === 'starting' ? 'Starting private connection… First reads can take a minute or two.'
    : 'Private connection unavailable. Your wallet reads have not been sent directly.';
  node.append(text);
  if (state === 'failed') {
    const button = document.createElement('button');
    button.textContent = 'Retry connection';
    button.onclick = () => { void start(); };
    node.append(button);
  }
}
function balanceNode(symbol: string, balance: Balance) {
  const box = document.createElement('div');
  box.className = 'balance';
  const label = document.createElement('div');
  label.className = 'token';
  label.textContent = symbol;
  const amount = document.createElement('div');
  amount.className = 'amount';
  amount.textContent = balance.amount === undefined ? '—' : formatBalance(balance.amount);
  const status = document.createElement('small');
  status.className = balance.failed ? 'error' : '';
  status.textContent = balance.failed ? (balance.amount === undefined ? 'Lookup failed · retry available' : 'Stale · refresh failed')
    : balance.updatedAt ? 'Updated ' + new Date(balance.updatedAt).toLocaleTimeString() : 'Awaiting first read';
  box.append(label, amount, status);
  return box;
}
function render() {
  document.querySelector('#count')!.textContent = String(wallets.length);
  walletList.replaceChildren();
  if (!wallets.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<span class="empty-icon" aria-hidden="true">◇</span><h3>Your watchlist starts here</h3><p>Add an Ethereum address to read its ETH and WETH balances.</p>';
    walletList.append(empty);
  }
  wallets.forEach((wallet, i) => {
    const card = document.createElement('article');
    card.className = 'wallet';
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
    refresh.textContent = wallet.loading ? 'Reading…' : wallet.eth.failed || wallet.weth.failed ? 'Retry' : 'Refresh';
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
    amounts.append(balanceNode('ETH', wallet.eth), balanceNode('WETH', wallet.weth));
    const route = document.createElement('div');
    route.className = 'route';
    route.textContent = wallet.loading ? 'Reading latest balances over your private route…'
      : 'Isolated route · ' + new URL(wallet.rpcUrl).hostname;
    card.append(head, amounts, route);
    walletList.append(card);
  });
}
async function refreshWallet(wallet: Wallet) {
  if (wallet.loading) return;
  wallet.loading = true;
  render();
  try { await readBalances(wallet, await connection.get()); }
  catch { wallet.eth.failed = wallet.weth.failed = true; }
  finally { wallet.loading = false; render(); }
}
async function start() {
  try { await connection.get(); }
  catch { /* connection status provides retry */ }
}
document.querySelector('#wallet-form')!.addEventListener('submit', (event) => {
  event.preventDefault();
  const raw = input.value.trim();
  if (!isAddress(raw)) {
    error.textContent = 'Enter a valid Ethereum address (0x followed by 40 hex characters).';
    input.setAttribute('aria-invalid', 'true');
    return;
  }
  const address = getAddress(raw);
  if (wallets.some(w => w.address === address)) {
    error.textContent = 'This wallet is already on your watchlist.';
    return;
  }
  input.removeAttribute('aria-invalid');
  error.textContent = '';
  const used = new Set(wallets.map(w => w.rpcUrl));
  const rpc = config.rpcUrls.find(url => !used.has(url)) || config.rpcUrls[wallets.length % config.rpcUrls.length]!;
  const wallet = makeWallet(address, rpc);
  wallets.push(wallet);
  persist();
  input.value = '';
  void refreshWallet(wallet);
});
render();
renderConnection();
void start();
wallets.forEach(wallet => { void refreshWallet(wallet); });
window.addEventListener('pagehide', () => connection.close());

window.addEventListener('pageshow', (event) => { if (event.persisted) void start(); });
