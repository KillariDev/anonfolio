# Published application screenshots

The README, HTML system guide and HTML/PDF presentation show a real public Ethereum mainnet watchlist: vitalik.eth, the Ethereum Foundation's public address, and the Uniswap governance treasury. They showcase the default ETH/WETH assets and two user-added ERC-20s, USDC and UNI, with locally supplied token icons.

The data was refreshed on November 6, 2026 at **13:08 UTC** by running the current application against mainnet in **explicit Direct HTTPS mode**. Helios verified finalized execution headers, account proofs, contract code and storage for all twelve holdings. All holdings and their price estimates used finalized block **26,355,929**. ETH/WETH and UNI values use the application's direct-pool 30-minute Uniswap v3 TWAPs; USDC is the quote asset itself. Zero WETH in the treasury is genuinely proven and is hidden by the normal UI. There are no invented balances or prices.

The screenshots show a historical snapshot, not an automatically updating portfolio. The combined portfolio total sums the displayed public addresses; it is not one person's portfolio. The connection indicator reflects the actual capture mode: it does not claim a Tor connection. Names are human-readable watchlist labels. These addresses are publicly identified examples, not addresses owned by this project.

## Files

- `readme-portfolio.png`: the compact portfolio overview used in the README and embedded in the presentation.
- `portfolio.png`: the same public-address snapshot with custom-token settings open, used in the HTML guide.
- `portfolio-snapshot.json`: exact capture timestamp, RPC operators, token definitions, raw balances, verified block hashes/state roots/timestamps, and bigint price fractions returned by the application. This is a reproducible data snapshot, not a collection of the full proof witnesses.

The presentation embeds the overview PNG; regenerate its PDF after changing the image. Other PNGs in `src/assets/` are application/token/technology artwork, not screenshots. Ignored `test-results/` images are diagnostic test artifacts and are not published documentation.

## Public address and token references

| Example | Mainnet address | Reference |
| --- | --- | --- |
| vitalik.eth | `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045` | [Public address/ENS label](https://etherscan.io/address/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045) |
| Ethereum Foundation | `0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe` | [Publicly labelled address](https://etherscan.io/address/0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe) |
| Uniswap treasury | `0x1a9C8182C09F50C8318d769245beA52c32BE35BC` | [Uniswap Foundation treasury registry](https://github.com/uniswapfoundation/governance-processes/blob/main/TREASURY_ADDRESSES.md) |
| USDC, 6 decimals | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | [Circle contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses) |
| UNI, 18 decimals | `0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984` | [Uniswap token contracts](https://developers.uniswap.org/docs/ecosystem/governance/uni) |

USDC and UNI PNGs are copied unchanged from the MIT-licensed Trust Wallet assets repository; see [token artwork credits](../../src/assets/tokens/README.md).

## Reproduce or refresh

Install dependencies and Chromium first (`bun install`, `bunx playwright install chromium`). The browser test starts/reuses Vite automatically.

Recreate both images from the saved verified snapshot without contacting mainnet:

```sh
UPDATE_SCREENSHOTS=1 bun run test:browser e2e/published-screenshots.spec.ts
bun scripts/sync-screenshot-docs.ts
UPDATE_PRESENTATION_PDF=1 bun run test:browser e2e/presentation.spec.ts --grep "self-contained presentation"
```

The inline environment assignments above use POSIX syntax. In PowerShell set the corresponding `$env:UPDATE_SCREENSHOTS`, `$env:SCREENSHOT_LIVE` or `$env:UPDATE_PRESENTATION_PDF` flag before invoking the command, then clear it with `Remove-Item Env:FLAG_NAME`.

For new mainnet data, replace `UPDATE_SCREENSHOTS=1` with `SCREENSHOT_LIVE=1` in the first command. This path uses the real application/verifier without mocked RPC responses, replaces the saved snapshot only after every balance is proven and custom-token quotes succeed, and checks that no remote `eth_call` was used. It intentionally selects HTTPS for this public-data capture; the application's default remains Tor. Update the capture date/block description above when replacing the snapshot, then run the synchronization/PDF commands and build again.

The ordinary browser suite replays the checked-in snapshot through the UI's verification boundary, blocks external requests, and checks nonzero custom-token holdings, their estimates/icons, real addresses and responsive rendering. Replay changes neither the stored raw amounts nor the price fractions and is not a new live proof verification. The separate live command exercises the actual verifier.

## Separate ten-image gallery

The [repository screenshot gallery](../../screenshots/README.md) is a separate live capture: four public accounts including the ENS DAO treasury, five tokens including ENS, and desktop/tablet/mobile and verification views. Its per-image metadata lives in `screenshots/mainnet-snapshots.json`; it does not replace the three-address snapshot used by this page, the README hero, guide and presentation. Regenerate it with `SCREENSHOT_GALLERY=1 bun run test:browser e2e/screenshot-gallery.spec.ts`. ENS remains unpriced where no direct USDC pool qualifies. Both capture workflows explicitly use verified Direct HTTPS; neither claims a live Tor connection.
