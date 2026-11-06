import torLogo from './assets/technology/tor-light.svg?no-inline';
import uniswapLogo from './assets/technology/uniswap.svg?no-inline';
import ethereumLogo from './assets/tokens/eth.png';

const technologies = {
  tor: { src: torLogo, label: 'Tor via Anon-RPC' },
  ethereum: { src: ethereumLogo, label: 'Ethereum mainnet' },
  uniswap: { src: uniswapLogo, label: 'Uniswap v3 · 30-minute TWAP estimates' },
};
// Locally bundled artwork: rendering a technology never contacts its website.
export function technologyIcon(kind: keyof typeof technologies, decorative = false) {
  const { src, label } = technologies[kind];
  const image = document.createElement('img');
  image.className = 'technology-logo technology-' + kind;
  image.src = src;
  image.width = image.height = 18;
  image.title = label;
  image.alt = decorative ? '' : label;
  if (decorative) image.setAttribute('aria-hidden', 'true');
  return image;
}
