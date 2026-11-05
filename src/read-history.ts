import { tokenBalance, type Balance, type Wallet } from './balances';
import { statusIcon, tokenIcon } from './icons';
import type { Token } from './tokens';
import type { VerifiedBlock } from './verification/trust';

function readTime(timestamp: number) {
  const date = new Date(timestamp);
  const time = document.createElement('time');
  time.dateTime = date.toISOString();
  time.textContent = date.toLocaleString(undefined, { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' });
  time.title = date.toLocaleString() + ' · ' + Intl.DateTimeFormat().resolvedOptions().timeZone;
  return time;
}
export function readHistory(wallet: Wallet, tokens: Token[]) {
  const section = document.createElement('section'); section.className = 'read-history';
  section.setAttribute('aria-label', 'Balance read history');
  const groups = new Map<string, { block?: VerifiedBlock; rows: { token:Token; balance:Balance }[] }>();
  for (const token of tokens) {
    const balance = tokenBalance(wallet, token);
    const key = balance.verifiedBlock?.hash.toLowerCase() || (balance.updatedAt ? 'legacy' : 'pending');
    if (!groups.has(key)) groups.set(key, { block:balance.verifiedBlock, rows:[] });
    groups.get(key)!.rows.push({token,balance});
  }
  for (const [key, group] of groups) {
    const card = document.createElement('article'); card.className = 'read-snapshot';
    const header = document.createElement('div'); header.className = 'snapshot-heading';
    const heading = document.createElement('strong');
    const blockName = group.block ? 'Finalized block #' + BigInt(group.block.number).toLocaleString() : key === 'legacy' ? 'Unverified saved values' : 'Awaiting first read';
    card.setAttribute('aria-label', blockName);
    heading.textContent = blockName;
    header.append(heading);
    if (group.block) {
      header.prepend(statusIcon('verified', 'Verified block', 'These balances were proved against finalized block ' + group.block.hash));
      const blockTime = document.createElement('div'); blockTime.className = 'snapshot-time';
      const label = document.createElement('span'); label.textContent = 'Block time';
      blockTime.append(label, readTime(group.block.timestamp));
      header.append(blockTime);
    }
    card.append(header);
    const table = document.createElement('table'); table.className = 'read-times'; table.setAttribute('aria-label', 'Token reads · ' + blockName);
    const head = table.createTHead().insertRow();
    for (const label of ['Token', 'Last successful read']) {
      const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label; head.append(cell);
    }
    const body = table.createTBody();
    for (const {token,balance} of group.rows) {
      const row = body.insertRow(); row.dataset.asset = token.address;
      const name = document.createElement('th'); name.scope = 'row';
      const identity = document.createElement('span'); identity.className = 'history-token'; identity.title = token.address === 'eth' ? 'Native Ethereum' : token.address;
      identity.append(tokenIcon(token), document.createTextNode(token.symbol));
      name.append(identity);
      if (balance.failed || balance.cached) {
        const retained = Boolean(balance.updatedAt);
        const kind = balance.failed ? retained ? 'stale' : 'unavailable' : 'saved';
        const meaning = balance.failed ? retained ? 'Last refresh failed; showing the previous successful read.' : 'Last refresh failed; no successful read is available.' : 'Saved balance; refresh to check for updates.';
        name.append(statusIcon(kind, balance.failed ? retained ? 'Previous read' : 'Read unavailable' : 'Saved read', token.symbol + ': ' + meaning));
      }
      const time = document.createElement('td');
      if (balance.updatedAt) time.append(readTime(balance.updatedAt)); else time.textContent = '—';
      row.append(name,time);
    }
    card.append(table);
    if (group.block) {
      const hash = document.createElement('details'); hash.className = 'snapshot-hash'; hash.dataset.block = key;
      const toggle = document.createElement('summary'); toggle.textContent = 'Block hash'; toggle.title = group.block.hash; toggle.setAttribute('aria-label','Block hash '+group.block.hash);
      const code = document.createElement('code'); code.textContent = group.block.hash;
      hash.append(toggle,code); card.append(hash);
    }
    section.append(card);
  }
  return section;
}
