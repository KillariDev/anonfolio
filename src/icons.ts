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
    img.onerror = fallback;
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
