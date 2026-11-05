# Anonfolio

A standalone Bun, Vite and TypeScript Ethereum mainnet portfolio reader. Track wallet addresses and ERC-20 balances without connecting a wallet. Each wallet's reads use its own Anon-RPC/Tor isolation key.

## Run

Use [Bun](https://bun.sh) **1.3.14** (the project baseline):

```sh
bun install --frozen-lockfile
bun run dev                  # http://localhost:5173
bun run test                 # balance, storage, token and static-server tests
bunx playwright install chromium
bun run test:browser         # deterministic Chromium UI tests
bun run test:all             # unit tests, build, UI tests and production/offline checks
bun run test:live            # actual tor-js worker + mainnet; needs WebRTC/network access
bun run build               # type-check and produce dist/
bun run serve               # simple Bun static server, http://localhost:4173
```

Set `HOST` and `PORT` to change the static server's bind address and port. It serves only `dist/` and is not an RPC proxy. It accepts GET and HEAD and returns 404 for absent assets.

The committed lockfile uses format version 1 so Bun 1.3.14 can read it. Bun 1.4.x can install it with `bun install --frozen-lockfile`. Use Bun 1.3.14 when changing dependencies; a normal install with Bun 1.4.x may migrate the lockfile to version 2.

If you saw “Unknown lockfile version”, pull the latest branch and run `bun install --frozen-lockfile`. If an earlier install rewrote your local lockfile, restore `bun.lock` from the updated branch first.

## Portfolio layout and totals

The overview sums each token across all tracked addresses using exact bigint arithmetic and verified decimals (or labeled user-supplied decimals). ETH, WETH and each custom contract have separate totals; tokens with the same symbol remain separate. Removing an address or token updates the totals immediately. Totals do not trigger extra RPC requests.

A total uses only available balance values. Unknown amounts are not counted as zero: the coverage label shows how many addresses are included and marks incomplete totals as **Partial**. Retained cached or failed values are included with a stale count; a spinner and updating label indicate pending reads. These are sums of independently fetched values, not an atomic snapshot of a single block.

The watchlist uses compact table rows with refresh next to each address. Full addresses are shown whenever the column has room; smaller screens truncate only the visible text, retaining the full address for accessibility and tooltips. Choose **Details** to see the full address, RPC operator, read timestamps and request progress. Expanded rows stay open while results arrive. Adding addresses, token settings and connection diagnostics are collapsible; the address form closes after adding entries. Narrow screens scroll the table horizontally while the address column stays visible. Long watchlists scroll within the table with fixed column headers.

## Tracking wallets and tokens

Paste one Ethereum address or a list separated by newlines, commas, spaces or semicolons, then choose **add address to track**. Validation happens locally before adding any address. Invalid entries reject the whole list; existing wallets and duplicates are skipped. Every wallet has its own Refresh/Retry and Remove buttons. Removing an address requires confirmation showing its name (if set) and full address; cancelling keeps the address and its saved balances. Give a single address an optional name, or enter a named list as `Savings | 0x…`, one entry per line. Names are limited to 80 characters and are saved alongside addresses and cached balances. Existing unnamed entries continue to work. The shared address component shows the name above the address in wallet rows and expanded details. Its mirrored 8×8 blockie SVG is generated deterministically from the address, without dependencies or network requests; the same address keeps its icon across reloads and letter casing. Names are display-only and never enter RPC payloads or page URLs.

ETH and WETH are included by default in the same tracked-token list as every other asset. All tokens have the same Remove and Change icon controls. Removing a token removes its column, total and future balance requests; removing the last token leaves addresses saved without making balance requests. Removed defaults stay removed after reload. The add form has ETH/WETH presets for re-adding them, plus a custom ERC-20 option. Native ETH intrinsically uses 18 decimals; its balance is proven from the account trie. ERC-20 balanceOf and decimals execute locally against proven state.

Open the top-right **Settings** gear, then expand **Tracked tokens** to add a mainnet ERC-20 by contract address, symbol and decimals, with an optional uploaded icon. The supplied symbol is a display setting. Decimals are verified by local execution of decimals(); if unavailable, the supplied decimals are explicitly labeled user-supplied. For example, USDC has 6 decimals. Adding a token refreshes wallets; if a wallet is already reading, one follow-up refresh is queued.

The application icon is bundled locally and used in the header and browser tab, including offline/IPFS builds. Token icons appear in totals, table headers and settings. ETH/WETH icons are bundled with the app. Uploaded PNG/JPEG/WebP images (up to 1 MB) are decoded locally, fitted into a 64×64 PNG, and saved in localStorage. Every token can change its icon. Missing or unreadable icons use a symbol badge. Remote icon URLs and SVG uploads are not accepted, so icons cause no third-party image requests and remain available offline. Bundled icon sources and their MIT license are recorded in [src/assets/tokens](src/assets/tokens/README.md).

Token configuration itself requires no network request. Balance refreshes use the shared Helios verifier: ETH account proofs and local ERC-20 balanceOf execution at one verified finalized block per wallet refresh. Proofs, code and retries use that wallet's private Anon-RPC route. There are no approvals, transactions or wallet connections.

## Progress and saved balances

Spinners indicate worker startup, wallet refresh and individual pending reads. The connection panel shows public worker discovery, its RPC hostname, advertised resolver hosts, and waiting for the hash-verified sandboxed worker. Configured gateway endpoints are shown as configuration: the harness does not expose live gateway or circuit-building progress.

Each wallet's expandable Details panel shows per-asset request details: the RPC method and destination hostname, token contract when applicable, verified finalized block hash/time, private proof submission, retry attempts and the final result. The address appears once above the activity rather than repeating for every token. “Submitted” means handed to the worker; it does not claim that a gateway or destination has already been reached.

Successful amounts and timestamps are saved immediately and independently; a slow or failed token does not delay storing other successful reads. Raw amounts and totals use exact bigint arithmetic. The UI rounds to at most two decimal places using integer arithmetic and removes trailing zeros; a positive amount below 0.01 displays as `<0.01`. Totals sum raw amounts before rounding, and stored balances retain their original precision. A proven zero is `0` with a verified-finalized label; an unavailable amount is `—`. Unverified legacy zeroes are labeled explicitly.

Wallet names, wallet/token additions and removals, balance values and successful-read timestamps are stored as one versioned localStorage snapshot. The app migrates the original address-only watchlist and the previous portfolio format into a complete active-token list and per-token balances. Explicitly removed defaults and empty token lists are preserved. Cached entries are validated when loaded; corrupt entries are ignored. Isolation keys, request payloads and RPC credentials are not persisted in the portfolio snapshot. Each verified amount stores its finalized block hash, state root, number and timestamp, together with verified/display decimals. Legacy amounts have no verification provenance and are labeled unverified until refreshed. Cached verified metadata is historical, and every reload reverifies it.

On reload, saved values appear immediately with their original timestamps and stale/cache labels while independent refreshes run. Failed reads retain the last successful amount and timestamp. Failed first reads show an error. Storage failures display a warning while the current in-memory session remains usable. Browser storage can be cleared or evicted by the user or browser.

The production build includes a service worker that caches only the application HTML, JavaScript, CSS and bundled icon assets after a successful initial visit. It permits an offline reload of saved wallets, tokens and balances; it never caches or intercepts RPC, resolver, or gateway requests. HTTPS (or localhost) and browser service-worker support are required. The first visit still needs a network connection. Connection startup and failed balance retrievals retry automatically with delays of 2, 4, 8, 16, 32, then at most 60 seconds between rounds. The UI shows the next scheduled attempt. Automatic balance retries read only failed assets, preserving successful values and timestamps. Retries pause offline and resume immediately when connectivity returns. Successful retrieval, removing the address, or leaving the page stops its scheduled retries. Manual Refresh/Retry starts a fresh round immediately.

## Deployment

Upload the contents of `dist/`, including `sw.js`, to a static **HTTPS** host. No backend, wallet extension, API key or routing rules are required. Localhost works for development. Build for a subdirectory with `bun run build --base=/your-path/`. Serve `sw.js` with revalidation/no-cache so browsers can discover updated application builds.

Copy `.env.example` to `.env.local` before building:

| Variable | Purpose |
| --- | --- |
| `VITE_BOOTSTRAP_RPC` | Public mainnet HTTPS RPC used only to resolve the worker specifier. |
| `VITE_ANON_GATEWAYS` | Comma-separated KPS gateway entries, each `ip:port:certhash`. |
| `VITE_RPC_URLS` | Comma-separated mainnet HTTPS RPC endpoints, preferably different operators. |

The shipped gateway is the official guide's **development demo gateway**, with limited capacity and availability. Run your own tor-js gateway for deployment and configure its entry. All `VITE_*` settings are public bundle contents; never put secrets there. Endpoints must be Ethereum mainnet; the app does not add chain-ID requests to balance reads.

The top-right **Settings** gear opens a compact panel for tracked tokens and network configuration. Close it with Escape, the close button, or a click outside. Token changes save automatically. Use the **Network connection** section to change Tor gateways, private balance RPC endpoints and the public discovery RPC without rebuilding. Enter one gateway or HTTPS RPC URL per line. Gateway entries support `ip:port:certhash` and `[ipv6]:port:certhash`. RPC endpoints must serve Ethereum mainnet; settings are validated locally without querying watched addresses.

**Save settings and reconnect** saves browser-local overrides and reloads the page, closing the previous worker and replacing all wallet clients together. Saved balances and token/address configuration remain visible as stale data while fresh private reads start. Existing requests cannot update the new page or retry using old endpoints. **Restore defaults** clears only the network overrides and reconnects using the deployment's `VITE_*` defaults. Corrupt settings fall back to deployment defaults; failed storage writes keep the existing session and show an error. Settings persist full endpoint URLs, including any query/path API keys, in localStorage; they are accessible to anyone with access to this browser's storage. Overrides apply only in this browser.

Default operators are PublicNode, dRPC and Ankr. Some public endpoints reject Tor exits or require credentials; replace unavailable operators. A wallet uses an unused endpoint where possible, then reuses configured endpoints if the watchlist exceeds the pool.

The harness uses a sandboxed srcdoc iframe and blob worker. If the host adds a strict Content Security Policy, follow the harness README's same-origin `iframeUrl` bootstrap workflow or permit its required inline/worker capabilities. Browser WebRTC/KPS connectivity is required for new reads.

## Routing and privacy

One long-lived `AnonRpcWorker` uses mainnet tor-js specifier `0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e`. Public bootstrap requests read only the worker contract; watched addresses never enter that client. The harness fetches and hash-verifies the published worker bundle.

Each wallet receives a random UUID isolation key and an explicit private execution route. One shared Helios consensus light client queues wallet execution serially. Every execution-network attempt uses `worker.fetch` with that wallet's `anonOptions.isolationKey`. Keys survive refresh and retry for the in-memory wallet's lifetime; reload creates new keys. HTTP batching, multicall and CCIP redirects are disabled. There is no direct-fetch or public-RPC fallback. Helios internal HTTP retries and subsequent automatic rounds keep the same wallet endpoint and key. There is no ordinary-fetch execution transport.

ETH uses eth_getProof against the verified finalized state root. WETH and every custom ERC-20 use local Helios/revm balanceOf execution with verified bytecode and demanded storage, including proxy dependencies. Mainnet WETH is `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`. All assets in one refresh use one verified finalized block hash. Independent wallets/refreshes can observe different finalized blocks; totals explicitly label mixed blocks. Different decimals across snapshots suppress the aggregate.

Each execution request attempt has a 90-second timeout; each Tor worker startup attempt has a two-minute timeout. A verification session is bounded to five minutes. Failed rounds retry automatically with capped exponential backoff. The UI keeps saved amounts visible throughout. The bootstrap provider sees discovery, and each RPC operator sees its wallet queries. Tor keys isolate circuits and TLS sessions but can randomly share an exit. The Tor bundle must match a hard-coded reviewed digest, even if the bootstrap RPC claims a different on-chain hash. The app trusts the independently pinned consensus checkpoint, the reviewed Helios WASM and the pinned Tor implementation; RPC state is verified locally.

No analytics, external fonts, address links, address URL parameters or address logging are added. A referrer policy prevents outgoing referrers. Wallets and cached balances are intentionally stored in this browser; anyone with access to its storage can read them.

## Verification

`bun run test:all` runs the deterministic suite, production build and Chromium checks, including a fully offline production reload. Browser scenarios cover local validation, bulk additions, custom tokens and decimals, spinners, request status, cached balances, stale refreshes, recovery, storage failures, removals, persistence automatic retry recovery, offline pause/resume, cancellation, and mobile layout. Retry scheduler tests verify capped backoff and prevent duplicate work. Transport and verifier tests check requested-address/root/slot binding, code hashes, no batches, distinct keys, private retries, partial completion and forbidden public fallbacks. Static-server tests check content, headers, HEAD, missing files, invalid methods and path traversal.

The [GitHub Actions workflow](.github/workflows/test.yml) tests Bun 1.3.14 and 1.4.3 with locked installs. Failed browser checks retain screenshots, traces and HTML reports.

Live mainnet tests remain opt-in because they depend on external gateway, RPC and Tor availability. To test the production build:

```sh
bun run build
BASE_URL=http://127.0.0.1:4173 bun run test:live
```

The test runner starts the static server if needed. Deterministic UI tests replace the connection boundary only in Playwright; the production app has no mock mode.

References: [Anon-RPC web integration](https://ethereum.github.io/anon-rpc/wallets/), [tor-js circuit isolation](https://github.com/ethereum/tor-js#circuit-isolation), and [browser harness](https://github.com/ethereum/anon-rpc/tree/main/impl/browser-harness).

## IPFS publishing

The Docker publisher follows [Sealwort's IPFS deployment](https://github.com/DarkFlorist/Sealwort/tree/bc67c11581a0dba371a7335fe0220d9dc47ef396) (Unlicense): a pinned Bun builder produces the site, a pinned Kubo v0.25.0 computes a CIDv1 for the directory, and the runtime uploads and pins that same directory to your Kubo RPC API. Publishing fails if the returned CID differs from the build-time CID. No pinning provider is selected or authenticated automatically.

The matching package commands are:

```sh
bun run typecheck
bun run check
bun run ui:docker
```

`check` runs unit tests, type checking and the production build. `ui:docker` builds the `anonfolio-ui` image, publishes `/export` to the host's existing Kubo node, checks its CID, and prints `http://<CID>.ipfs.localhost:8080/`. It requires a running Docker engine and Kubo; it does not start or reconfigure your node. Like Sealwort, its default RPC multiaddress is `/dns4/host.docker.internal/tcp/5001`, with a host-gateway mapping for Linux and Docker Desktop support on Windows/macOS.

Override the RPC multiaddress if necessary:

```sh
IPFS_API_MULTIADDR=/ip4/192.0.2.10/tcp/5001 bun run ui:docker
```

In PowerShell:

```powershell
$env:IPFS_API_MULTIADDR = '/ip4/192.0.2.10/tcp/5001'
bun run ui:docker
```

A Linux host daemon bound only to `127.0.0.1:5001` is not reachable via Docker's host-gateway mapping. Use a trusted container network or a private host address reachable from the publisher. Keep the Kubo RPC API private; the browser needs only the gateway. The printed URL assumes your gateway listens on port 8080; use your actual gateway port or HTTPS domain otherwise. The runtime pins content on your node; continued public availability requires keeping that node reachable or pinning the CID elsewhere.

The ready-to-install IPFS workflow template in [.github-workflows/ipfs-deploy.yml](.github-workflows/ipfs-deploy.yml) builds and pushes a GHCR image for `main` and `v*` tags. Enable it by copying the template into `.github/workflows/ipfs-deploy.yml` using credentials with workflow-write permission (the current repository token cannot push workflow changes). Tags also attach `anonfolio.car` and `ipfs-cid.txt` to the GitHub release, using the same checked CID. Import an artifact into your chosen Kubo node with `ipfs dag import anonfolio.car`; it contains the full site and pins the root by default. You can also produce the artifact directly from an image without publishing to a host node:

```sh
mkdir -p ipfs-artifacts
docker run --rm --entrypoint /bin/sh --volume "$PWD/ipfs-artifacts:/output" anonfolio-ui /export-ipfs.sh
```

The production build forces Bun as the JavaScript runtime, matching the Docker builder. Builds use relative asset paths, so the same directory works at both `https://<CID>.ipfs.<gateway>/` and `https://<gateway>/ipfs/<CID>/`. Keep the trailing slash. The app's service worker registers under that directory and caches only the application files; RPC and gateway connections remain uncached. Use HTTPS (or local loopback gateways) for browser worker and offline support. The Docker build uses the shipped deployment defaults; browser Settings can override gateways and RPCs after loading.

Prefer a subdomain gateway for per-CID browser origin isolation. A path gateway shares browser storage with other applications on that gateway origin. With subdomain gateways, each new CID has a separate origin, so wallets, names and settings from a previous CID do not automatically carry over.

### Verify a real local IPFS deployment

Install Kubo (tested with v0.25.0), Chromium via `bunx playwright install chromium`, and a POSIX shell (Linux, macOS or WSL), then run:

```sh
bun run test:ipfs
# Or point to an installed Kubo binary:
IPFS_BIN=/path/to/ipfs bun run test:ipfs
# Include actual mainnet reads through the real tor-js worker:
LIVE_RPC=1 bun run test:ipfs
```

The check builds the production site, starts an isolated offline Kubo node on random loopback ports, runs the exact Docker publishing script, checks CID-mismatch rejection, exports a CAR, and imports it into a fresh repository. Chromium loads the site through actual path and subdomain gateways and checks relative assets, service-worker scope, named wallets, tokens, cached zero balances, offline reloads and absence of public balance requests. It leaves `ipfs-artifacts/anonfolio.car` and `ipfs-artifacts/ipfs-cid.txt`, then stops the temporary node. It never changes an existing Kubo configuration, pins to a public provider, or requires Docker. The optional live check additionally exercises ETH/WETH/USDC, two wallets, zero balances and manual refresh from the IPFS-hosted production page.


## Browser-side balance verification

[Helios 0.12.0](https://github.com/a16z/helios/tree/0.12.0), including [PR #813](https://github.com/a16z/helios/pull/813), is vendored as unchanged WASM with an adapted internal HTTP bridge. See [the review and trust boundaries](vendor/helios/README.md). One shared consensus client verifies sync committee signatures and finalized execution headers, starting from an independently pinned mainnet checkpoint. Each refresh freezes a single finalized block hash and state root before reading any asset. No unverified balance fallback exists.

The dedicated verifier worker restricts public networking to beacon consensus GETs. Every execution proof, code fetch, block-body lookup and retry crosses the explicit main-thread bridge into the existing wallet's Anon-RPC worker and isolation key. State requests are bound to the frozen block hash. Account addresses, requested storage slots and bytecode hashes are checked both at the adapter boundary and by Helios. Helios/revm demand-loads verified state for balanceOf and decimals, including delegatecall/proxy dependencies. Remote eth_call and access-list execution hints are not used.

ETH verifies eth_getProof against the finalized state root. All ERC-20 contracts use local EVM execution; there are no assumed balance storage layouts. decimals() is verified independently at the same block; if it reverts or is unavailable, the UI marks the configured decimals as user-supplied. A failed proof/transport preserves historical amounts as stale. Missing data never becomes zero. Totals identify mixed finalized blocks and suppress aggregation if decimals differ.

Progress reports the actual step: loading and digest-checking WASM, public beacon requests, consensus verification, private RPC method submission, Merkle-proof checking, verified bytecode, local execution and decimals verification. Details show the finalized block hash/time; compact rows show current work without needing to expand them.

The checkpoint expires after 14 days and requires a reviewed source update, using independent operators. Runtime RPC settings and browser cache cannot change the checkpoint or binary pins. Frozen finalized blocks older than one hour are rejected. The shared verifier serializes wallet execution, trading throughput for a single consensus sync and unambiguous private routing. Proof-unavailable RPC operators fail closed; configure a mainnet endpoint supporting eth_getProof and EIP-1898 block-hash queries.

Run `bun run test:all` for unit, adversarial and deterministic UI/offline checks. `BASE_URL=http://127.0.0.1:4173 bun run test:live` exercises the actual production WASM and Tor worker (build first); the live checks additionally reject any ordinary browser proof/code requests. UI fixtures replace the verifier boundary only inside tests, never in the shipped app. Unit regressions use genuine generated trie proofs for wrong-wallet, wrong-block, omitted-nonzero-slot, exclusion/zero and tampered-bytecode attacks; transport tests forbid native-fetch fallbacks. `LIVE_RPC=1 bun run test:ipfs` runs the same verifier on a real local Kubo gateway.
