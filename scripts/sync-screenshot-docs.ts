import { readFile, writeFile } from 'node:fs/promises';

// Synchronize the actual browser captures and their provenance. No pixels or
// application data are synthesized or edited by this script.
const snapshot = JSON.parse(await readFile(new URL('../docs/images/portfolio-snapshot.json',import.meta.url),'utf8'));
const date = new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(snapshot.capturedAt));
const caption = `Public mainnet snapshot · ${date} · ETH, WETH, USDC and UNI · Helios-verified over direct HTTPS.`;
const alt = 'Anonfolio tracking vitalik.eth, the Ethereum Foundation and Uniswap treasury with real ETH, WETH, USDC and UNI holdings.';
const root = new URL('../',import.meta.url);
const readmeImage = await readFile(new URL('docs/images/readme-portfolio.png',root));
const guideImage = await readFile(new URL('docs/images/portfolio.png',root));
const dimensions = (bytes: Buffer) => ({width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)});
const readmeSize = dimensions(readmeImage), guideSize = dimensions(guideImage);
const readmePath = new URL('README.md',root);
let readme = await readFile(readmePath,'utf8');
const screenshotBlock = /<!-- portfolio-screenshot -->[\s\S]*?<!-- \/portfolio-screenshot -->/;
// Preserve the shortened README's choice to omit a visible snapshot caption.
const readmeCaption = readme.match(screenshotBlock)?.[0].includes('*Public mainnet snapshot') ? `*${caption} [Capture details](docs/images/README.md).*\n` : '';
readme = readme.replace(screenshotBlock,`<!-- portfolio-screenshot -->\n![${alt}](docs/images/readme-portfolio.png)\n\n<details><summary>Light theme</summary>\n\n![${alt} Light theme.](docs/images/readme-portfolio-light.png)\n\n</details>\n\n${readmeCaption}<!-- /portfolio-screenshot -->`);
await writeFile(readmePath,readme);
const guidePath = new URL('docs/documentation.html',root);
let guide = await readFile(guidePath,'utf8');
guide = guide.replace(/(<img class="screenshot"[^>]*?)width="\d+" height="\d+"([^>]*?)alt="[^"]*"/,`$1width="${guideSize.width}" height="${guideSize.height}"$2alt="${alt} Custom-token settings show USDC and UNI with their contract addresses and icons."`);
guide = guide.replace(/(<figure><a class="screenshot-link"[\s\S]*?<figcaption>)[\s\S]*?(<\/figcaption>)/,`$1${caption} The settings panel shows the custom ERC-20s included in the watchlist.\n$2`);
await writeFile(guidePath,guide);
const deckPath = new URL('docs/presentation.html',root);
let deck = await readFile(deckPath,'utf8');
deck = deck.replace(/(<img class="screenshot" src=")[^"]+/,`$1data:image/png;base64,${readmeImage.toString('base64')}`);
deck = deck.replace(/(<img class="screenshot"[^>]*?)width="\d+" height="\d+" alt="[^"]*"/,`$1width="${readmeSize.width}" height="${readmeSize.height}" alt="${alt}"`);
deck = deck.replace(/(<figcaption class="caption">)[\s\S]*?(<\/figcaption>)/,`$1${caption}$2`);
await writeFile(deckPath,deck);
console.log(`Updated README, guide and presentation captions for ${snapshot.capturedAt}. Regenerate docs/presentation.pdf next.`);
