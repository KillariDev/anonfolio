import ethIcon from './assets/tokens/eth.png';
import wethIcon from './assets/tokens/weth.png';
import { validateIcon, type Token } from './tokens';

export function tokenIcon(token: Token) {
  const wrapper = document.createElement('span');
  wrapper.className = 'token-icon';
  wrapper.setAttribute('aria-hidden', 'true');
  const fallback = () => { wrapper.textContent = token.symbol.slice(0, 2).toUpperCase(); };
  fallback();
  let icon: string | undefined;
  try { icon = validateIcon(token.icon); } catch { return wrapper; }
  if (icon) {
    const img = document.createElement('img');
    img.alt = '';
    img.width = img.height = 22;
    img.src = icon === 'builtin:eth' ? ethIcon : icon === 'builtin:weth' ? wethIcon : icon;
    img.onerror = () => { if (img.parentElement) img.parentElement.textContent = token.symbol.slice(0, 2).toUpperCase(); };
    wrapper.replaceChildren(img);
  }
  return wrapper;
}
export async function readIcon(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1024 * 1024) {
    throw new Error('Choose a PNG, JPEG or WebP file up to 1 MB.');
  }
  let image: ImageBitmap;
  try { image = await createImageBitmap(file); }
  catch { throw new Error('This image could not be read. Choose a valid PNG, JPEG or WebP.'); }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable in this browser.');
    const scale = Math.min(64 / image.width, 64 / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.drawImage(image, (64 - width) / 2, (64 - height) / 2, width, height);
    return validateIcon(canvas.toDataURL('image/png'))!;
  } finally { image.close(); }
}

// Small local SVGs: no remote icon service or added dependency.
const statusPaths = {
  verified: '<path d="M12 2 4 5v6c0 5 8 11 8 11s8-6 8-11V5Z"/><path d="m8 11 3 3 5-6"/>',
  current: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
  saved: '<path d="M5 3h12l3 3v15H4V3Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
  stale: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  unavailable: '<path d="m12 3 10 18H2Z"/><path d="M12 9v5M12 17h.01"/>',
  unverified: '<path d="M12 2 4 5v6c0 5 8 11 8 11s8-6 8-11V5Z"/><path d="M12 7v6M12 16h.01"/>',
  unpriced: '<path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7" cy="7" r="1"/><path d="m12 10 5 5m0-5-5 5"/>',
  partial: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M12 3a9 9 0 0 1 0 18"/>',
  waiting: '<circle cx="12" cy="12" r="9"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
};
export type StatusIcon = keyof typeof statusPaths;
export function statusIcon(kind: StatusIcon, label: string, explanation = label) {
  const icon = document.createElement('span');
  icon.className = 'status-icon status-' + kind;
  icon.title = explanation;
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', explanation);
  icon.tabIndex = 0;
  icon.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + statusPaths[kind] + '</svg>';
  const text = document.createElement('span'); text.className = 'sr-only'; text.textContent = label;
  icon.append(text);
  return icon;
}
