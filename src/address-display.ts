import type { TrackedAddress } from './addresses';

// Small, address-seeded blockies: an 8×8 grid with mirrored rows and three colors.
// No network requests, canvas, or third-party code is needed to render the SVG.
export function blockieData(address: string) {
  const seed = [0, 0, 0, 0];
  [...address.toLowerCase()].forEach((char, i) => {
    seed[i % 4] = ((seed[i % 4]! << 5) - seed[i % 4]!) + char.charCodeAt(0);
  });
  const random = () => {
    const value = seed[0]! ^ (seed[0]! << 11);
    seed[0] = seed[1]!; seed[1] = seed[2]!; seed[2] = seed[3]!;
    seed[3] = seed[3]! ^ (seed[3]! >>> 19) ^ value ^ (value >>> 8);
    return (seed[3]! >>> 0) / 4294967296;
  };
  const color = () => `hsl(${Math.floor(random() * 360)} ${40 + Math.floor(random() * 60)}% ${30 + Math.floor(random() * 50)}%)`;
  const colors = [color(), color(), color()];
  const cells: number[] = [];
  for (let y = 0; y < 8; y++) {
    const half = Array.from({ length: 4 }, () => Math.floor(random() * 3));
    cells.push(...half, ...[...half].reverse());
  }
  return { colors, cells };
}
export function addressDisplay(wallet: TrackedAddress, compact = false) {
  const root = document.createElement('span');
  root.className = 'address-display' + (compact ? '' : ' full-address');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('width', '28'); svg.setAttribute('height', '28');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('blockie');
  const { colors, cells } = blockieData(wallet.address);
  cells.forEach((color, i) => {
    const rect = document.createElementNS(svg.namespaceURI, 'rect');
    rect.setAttribute('x', String(i % 8)); rect.setAttribute('y', String(Math.floor(i / 8)));
    rect.setAttribute('width', '1'); rect.setAttribute('height', '1');
    rect.setAttribute('fill', colors[color]!);
    svg.append(rect);
  });
  const text = document.createElement('span');
  text.className = 'address-text';
  if (wallet.name) {
    const name = document.createElement('span');
    name.className = 'address-name'; name.textContent = wallet.name; name.title = wallet.name;
    text.append(name);
  }
  const address = document.createElement('span');
  address.className = 'wallet-address' + (compact ? ' sr-only' : '');
  address.textContent = wallet.address;
  text.append(address);
  if (compact) {
    const short = document.createElement('span');
    short.className = 'address-short'; short.setAttribute('aria-hidden', 'true');
    short.textContent = wallet.address.slice(0, 8) + '…' + wallet.address.slice(-6);
    short.title = wallet.address;
    text.append(short);
  }
  root.append(svg, text);
  return root;
}
