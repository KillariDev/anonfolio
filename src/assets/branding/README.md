# Anonfolio artwork

`anonfolio-icon.png` is the original 1254 × 1254 RGBA image generated for this project with the built-in image-generation tool on November 6, 2026. It replaces the previous lowercase “a” mark. The folded mint shield and check-shaped opening represent private requests and locally verified balances. Transparent corners and the original alpha channel are preserved.

The original raster artwork is retained as the master asset. The application header and favicon use `anonfolio-mark.svg`, a small native vector rendition of the same folded shield/check motif, to avoid downloading a 1.4 MB image for a 28px mark. Documentation embeds the vector bytes so its HTML files remain portable and self-contained. No external icon service is used. Token and third-party technology logos retain their existing artwork and credits.

## Icon generation prompt

```
Use case: logo-brand. Asset type: one finished application icon for Anonfolio, a private Ethereum portfolio reader with locally verified balances. Create an original, polished, memorable geometric emblem: two broad interlocking folded bands forming a compact protective shield with a bold check-shaped negative-space opening. Subtle layered/faceted construction evokes cryptographic proofs and a portfolio, without coins, locks, onions or other brands' symbols. Flat vector-like raster artwork with precise smooth edges and strong silhouette, not a mockup. Palette: pale mint green #b8ec8c and a slightly deeper sage green, with deep forest #101510 negative space. A mint emblem on a solid deep-forest rounded-square app tile; only the small area outside the rounded tile is genuinely transparent. Square 1024x1024 composition, tile occupies almost the whole canvas, emblem large and optically centered with roughly 15% internal padding. Must remain recognizable at 16px and 28px: very few large shapes, no tiny nodes, no thin strokes, no intricate details. No typography, letters, wordmark, text, border, drop shadow, glow, 3D perspective, photographic texture, presentation background, or watermark. Output exactly one isolated icon, no variants or size examples.
```

## README cover

[`docs/images/anonfolio-cover.png`](../../../docs/images/anonfolio-cover.png) is the redesigned README cover, generated with the built-in image-generation tool on November 6, 2026. It replaces the earlier grid-backed banner while retaining the exact wordmark, tagline, forest/mint palette, and folded shield/check identity. The cover adds more deliberate typography, dimensional shield lighting, translucent proof-like layers, and flowing private-routing paths.

The generated 1983 × 793 opaque PNG remains the first image in the README. The initial redesign used the prior cover and original application icon as visual references. A subsequent built-in image edit added a technology strip naming IPFS, Anon-RPC and Tor, using their source artwork as references. The final generated PNG is copied unchanged into the repository. These are generated renditions of third-party marks; sources and credits are recorded in [the technology artwork notes](../technology/README.md). This is brand illustration, not an application screenshot, network diagram, or display of portfolio data. Previous covers remain available in Git history.

### Initial cover generation prompt

```text
Use case: ads-marketing.
Asset type: a finished, premium wide GitHub README cover for Anonfolio, approximately 2400 × 960, 2.5:1 landscape.
Input images: Image 1 is the current cover to redesign. Image 2 is the existing application icon and the authoritative brand-shape reference.
Primary request: make a substantially more art-directed, memorable successor to the current cover. Preserve the exact project name, tagline, forest/mint identity, and folded shield/check silhouette, but rebuild the composition and illustration with a sophisticated visual idea about private routes becoming verified state.
Scene/backdrop: near-black forest green #0c140f. A luminous but restrained architectural space with beautifully lit translucent layers. Eliminate the generic all-over square grid. Use fine orbital routing curves and a few precise nodes as intentional structural elements.
Subject: on the right, a beautifully crafted monumental version of the reference folded shield, in pale mint and brushed sage, above a low dark glass plinth made of a few stacked translucent proof-like planes. Thin green routes curve around and behind the shield and resolve into orderly, crisp geometric layers. The shield's cut-out remains a single bold check-shaped negative space. Retain the original recognizable geometry rather than inventing a new logo.
Style: high-end editorial technology art direction, exquisitely controlled three-dimensional lighting, fine material detail, precision, visual depth, velvety darks, soft rim light. Contemporary and original; neither a stock cybersecurity advertisement nor an overly glossy game render.
Composition: use the existing banner's left text/right emblem reading order, but improve balance, spacing and depth. Text occupies about the left half, emblem fills the right half with ample breathing room. Keep a clean quiet area behind the type and broad safe margins on every edge. Shield must be fully inside frame. At GitHub's roughly 900px display width, wordmark and both tagline lines must read clearly.
Typography: the wordmark is large and confident in a beautifully spaced lowercase geometric sans serif, warm off-white, with its final dot mint green. Tagline is smaller but easily legible and deliberately spaced beneath the wordmark. Avoid extreme boldness that overwhelms the illustration.
Text, verbatim, and no other text:
"anonfolio."
"Private Ethereum portfolios."
"Verified in your browser."
Palette: forest #101510, near-black, pale mint #b8ec8c, muted sage, off-white #eef4e9. Restrained natural tonal gradients, excellent contrast. No purple or neon blue.
Constraints: exactly one complete opaque full-bleed cover. Preserve spelling and punctuation. No fake application interface, invented balances, charts, wallet addresses, pseudo-code, crypto coins, token logos, padlocks, hooded figures, badges, frames, watermarks, additional text, excessive glow or visual clutter. This is brand illustration, not a screenshot.
```

### Technology strip edit prompt

Built-in image-generation edit, November 6, 2026. Inputs: previous cover, local IPFS and Tor logos, and the Anon-RPC site favicon. SVG references were rasterized for the tool; original SVG files were preserved.

```text
Use case: compositing. Asset type: finished wide GitHub README cover, opaque PNG, preserve approximately 2.5:1 aspect ratio.
Image 1 is the existing cover, the edit target. Images 2, 3, and 4 are supporting logo inserts: official IPFS cube, official Tor wordmark/onion, and Anon-RPC project's site favicon (purple/pink outlined shield and keyhole on dark rounded tile), respectively.
Edit the existing cover to clearly mention and show all three technologies. Preserve the forest/mint atmosphere, large 'anonfolio.' wordmark, both existing tagline lines, the large dimensional mint folded shield on the right, translucent plinth and flowing paths. Keep overall identity and framing.
Add one elegant, well-spaced horizontal technology strip under the tagline in the lower left, leaving generous margins and avoiding the right-hand shield. Show three compact logo-and-label groups, each with the correct referenced logo and exact label: 'IPFS', 'Anon-RPC', 'Tor'. Keep the IPFS cube teal, Anon-RPC mark purple/pink, and Tor wordmark purple/green; retain the logos' actual distinctive geometry and proportions. Give logos small light or dark backing tiles only as necessary for contrast. Logos should feel intentional and readable at GitHub display sizes, with labels in crisp off-white typography. Do not use a generic substitute icon for any technology.
Existing text must remain verbatim:
'anonfolio.'
'Private Ethereum portfolios.'
'Verified in your browser.'
New text verbatim: 'IPFS', 'Anon-RPC', 'Tor'.
Use balanced restrained spacing. No other text, no duplicate marks, no portfolio numbers, no interface mockup, no watermark. Exactly one full-bleed finished cover.
```
