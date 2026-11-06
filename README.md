![Anonfolio — Private Ethereum portfolios. Verified in your browser.](docs/images/anonfolio-cover.png)

# Anonfolio

A browser-verified Ethereum mainnet portfolio tracker, built for IPFS. Track named addresses, ETH/WETH and custom ERC-20s without connecting a wallet.

**Tor via Anon-RPC is the default.** Helios verifies balances locally against finalized Ethereum state. Optional **Direct HTTPS** exposes your IP to providers; the app never switches automatically.

<!-- portfolio-screenshot -->
![Anonfolio tracking vitalik.eth, the Ethereum Foundation and Uniswap treasury with real ETH, WETH, USDC and UNI holdings.](docs/images/readme-portfolio.png)

<!-- /portfolio-screenshot -->

[More screenshots](screenshots/README.md)

## Run locally

Install [Bun 1.3.14](https://bun.sh/), then:

```sh
bun install --frozen-lockfile
bun run dev
```

Open **http://127.0.0.1:5173**. To build and serve the production app:

```sh
bun run build
bun run serve
```

Open **http://localhost:4173**.

## Use

- Click **+** to add one or more addresses. Manage tokens, icons, pricing and network settings with the top-right gear.
- Refresh each address independently. Saved balances reopen without automatic refresh; failed reads retain previous values with stale indicators.
- View token totals and 30-minute Uniswap v3 TWAP estimates in USDC or a custom quote token. Assets without a qualifying direct pool stay unpriced, and totals are marked partial.

The default Tor gateway is a development demo. A recent trusted checkpoint and compatible RPC endpoints are required; see [network and trust setup](docs/documentation.html#configuration-builds-and-publishing).

## Technologies

| Technology | Role |
| --- | --- |
| <img src="src/assets/technology/bun.svg" height="22" alt=""> [Bun](https://bun.sh/) · <img src="src/assets/technology/vite.svg" height="22" alt=""> [Vite](https://vite.dev/) · <img src="src/assets/technology/typescript.svg" height="22" alt=""> [TypeScript](https://www.typescriptlang.org/) | Static UI, builds and local tooling. |
| <img src="src/assets/technology/tor.svg" height="22" alt=""> [Tor](https://www.torproject.org/) · [Anon-RPC](https://github.com/ethereum/anon-rpc) | Private requests with per-address isolation. |
| [Helios 0.12.0](vendor/helios/README.md) · WebAssembly/revm · EthereumJS Trie | Consensus, proofs and local contract execution. |
| <img src="src/assets/tokens/eth.png" height="22" alt=""> [Ethereum](https://ethereum.org/) · <img src="src/assets/technology/viem.png" height="22" alt=""> [viem](https://viem.sh/) | Mainnet data, ABI utilities and bigint arithmetic. |
| <img src="src/assets/technology/uniswap.svg" height="22" alt=""> [Uniswap v3](https://docs.uniswap.org/contracts/v3/overview) | Direct-pool TWAP price estimates. |
| <img src="src/assets/technology/ipfs.svg" height="22" alt=""> [IPFS/Kubo](https://docs.ipfs.tech/) · Docker | Static publishing, CID checks and CAR exports. |
| <img src="src/assets/technology/playwright.svg" height="22" alt=""> [Playwright](https://playwright.dev/) | Browser tests. |

[Artwork credits](src/assets/technology/README.md)

## Tests

```sh
bunx playwright install chromium
bun run test:all
```

For real-provider tests, Windows setup and screenshot regeneration, see the [testing guide](docs/documentation.html#testing-and-maintenance).

## GitHub Pages deployment

After the first deployment, the GitHub Pages site will be available at **https://killaridev.github.io/anonfolio/**.

To activate deployment:

1. Move [`.github-workflows/pages.yml`](.github-workflows/pages.yml) to `.github/workflows/pages.yml` and commit the change to `main`. The file is staged outside the active workflow directory because the setup token lacks permission to create GitHub Actions workflows; use GitHub's web editor or credentials with workflow write permission for this step.
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source.
3. Run **Deploy GitHub Pages** from the Actions tab, or push a commit to `main`.

The workflow tests and builds the app with Bun 1.3.14, then deploys `dist/` on every push to `main`. It can also be run manually from the Actions tab.

The existing relative asset paths support the `/anonfolio/` project path, including workers, WebAssembly, documentation and the offline service worker. Public build-time network settings use the defaults in `src/config.ts`; to customize a deployment, set `VITE_*` values in the workflow's build step (see `.env.example`).

## IPFS deployment

Publish the complete `dist/` directory to IPFS, preferably through an HTTPS subdomain gateway. Each release has an immutable CID; a new CID/origin does not automatically carry over saved portfolios.

<!-- ipfs-build -->
**IPFS build:** [ipfs://bafybeig6wynwtacu6ljarm72zrhvfvmmtkmnmgy5j3zzjjncvz7ujvdbx4/](ipfs://bafybeig6wynwtacu6ljarm72zrhvfvmmtkmnmgy5j3zzjjncvz7ujvdbx4/)

Locally validated export; public availability requires pinning.
<!-- /ipfs-build -->

```sh
bun run test:ipfs   # native Kubo + Chromium; no Unix shell or Docker needed
bun run ui:docker   # Docker publishing through a reachable Kubo API
```

See [publishing](docs/documentation.html#configuration-builds-and-publishing) and [gateway deployment](deploy/tor-gateways/README.md).

## Documentation

[System guide](docs/documentation.html) · [Technical slides](docs/presentation.html) · [PDF](docs/presentation.pdf) · [Uniswap feedback](FEEDBACK.md)
