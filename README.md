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

## Tracking wallets and tokens

Paste one Ethereum address or a list separated by newlines, commas, spaces or semicolons, then choose **add address to track**. Validation happens locally before adding any address. Invalid entries reject the whole list; existing wallets and duplicates are skipped. Every wallet has its own Refresh/Retry and Remove buttons.

ETH and WETH are always tracked. Expand **Tracked tokens** to add a mainnet ERC-20 by contract address, symbol and decimals. The supplied symbol and decimals are display settings, not verified metadata. For example, USDC has 6 decimals. Custom tokens are tracked across every wallet and can be removed without affecting other assets. Adding a token refreshes wallets; if a wallet is already reading, one follow-up refresh is queued.

Token configuration requires no network request. All token balance reads use `balanceOf(address)` through the corresponding wallet's private client. There are no approvals, transactions or wallet connections.

## Progress and saved balances

Spinners indicate worker startup, wallet refresh and individual pending reads. The connection panel shows public worker discovery, its RPC hostname, advertised resolver hosts, and waiting for the hash-verified sandboxed worker. Configured gateway endpoints are shown as configuration: the harness does not expose live gateway or circuit-building progress.

Each wallet shows its RPC operator and per-asset request details: the RPC method, wallet address, token contract when applicable, latest block tag, submission to the private worker, retry attempts and the final result. “Submitted” means handed to the worker; it does not claim that a gateway or destination has already been reached.

Successful amounts and timestamps are saved immediately and independently; a slow or failed token does not delay storing other successful reads. Amounts use bigint and the configured token decimals without floating-point rounding. A successful zero is `0`; an unread amount is `—`.

Wallet/token additions and removals, balance values and successful-read timestamps are stored as one versioned localStorage snapshot. The app migrates the original address-only watchlist. Cached entries are validated when loaded; corrupt entries are ignored. Isolation keys, request payloads and RPC credentials are not persisted in the portfolio snapshot.

On reload, saved values appear immediately with their original timestamps and stale/cache labels while independent refreshes run. Failed reads retain the last successful amount and timestamp. Failed first reads show an error. Storage failures display a warning while the current in-memory session remains usable. Browser storage can be cleared or evicted by the user or browser.

The production build includes a service worker that caches only the application HTML, JavaScript and CSS after a successful initial visit. It permits an offline reload of saved wallets, tokens and balances; it never caches or intercepts RPC, resolver, or gateway requests. HTTPS (or localhost) and browser service-worker support are required. The first visit still needs a network connection. Connection startup and failed balance retrievals retry automatically with delays of 2, 4, 8, 16, 32, then at most 60 seconds between rounds. The UI shows the next scheduled attempt. Automatic balance retries read only failed assets, preserving successful values and timestamps. Retries pause offline and resume immediately when connectivity returns. Successful retrieval, removing the address, or leaving the page stops its scheduled retries. Manual Refresh/Retry starts a fresh round immediately.

## Deployment

Upload the contents of `dist/`, including `sw.js`, to a static **HTTPS** host. No backend, wallet extension, API key or routing rules are required. Localhost works for development. Build for a subdirectory with `bun run build --base=/your-path/`. Serve `sw.js` with revalidation/no-cache so browsers can discover updated application builds.

Copy `.env.example` to `.env.local` before building:

| Variable | Purpose |
| --- | --- |
| `VITE_BOOTSTRAP_RPC` | Public mainnet HTTPS RPC used only to resolve the worker specifier. |
| `VITE_ANON_GATEWAYS` | Comma-separated KPS gateway entries, each `ip:port:certhash`. |
| `VITE_RPC_URLS` | Comma-separated mainnet HTTPS RPC endpoints, preferably different operators. |

The shipped gateway is the official guide's **development demo gateway**, with limited capacity and availability. Run your own tor-js gateway for deployment and rebuild with its entry. All `VITE_*` settings are public bundle contents; never put secrets there. Endpoints must be Ethereum mainnet; the app does not add chain-ID requests to balance reads.

Default operators are PublicNode, dRPC and Ankr. Some public endpoints reject Tor exits or require credentials; replace unavailable operators. A wallet uses an unused endpoint where possible, then reuses configured endpoints if the watchlist exceeds the pool.

The harness uses a sandboxed srcdoc iframe and blob worker. If the host adds a strict Content Security Policy, follow the harness README's same-origin `iframeUrl` bootstrap workflow or permit its required inline/worker capabilities. Browser WebRTC/KPS connectivity is required for new reads.

## Routing and privacy

One long-lived `AnonRpcWorker` uses mainnet tor-js specifier `0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e`. Public bootstrap requests read only the worker contract; watched addresses never enter that client. The harness fetches and hash-verifies the published worker bundle.

Each wallet receives a random UUID isolation key and dedicated viem HTTP client. Every balance attempt uses `worker.fetch` with that wallet's `anonOptions.isolationKey`. Keys survive refresh and retry for the in-memory wallet's lifetime; reload creates new keys. HTTP batching, multicall and CCIP redirects are disabled. There is no direct-fetch or public-RPC fallback. Each round includes one viem retry on the same endpoint and key; subsequent automatic rounds keep that endpoint and key.

ETH uses `getBalance({ address, blockTag: 'latest' })`. WETH and custom tokens use `readContract` with `erc20Abi`, `balanceOf(address)` and `blockTag: 'latest'`. Mainnet WETH is `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`. Reads are independent and can observe different blocks. Values are reported by the operator, not independently verified.

Each request attempt has a 90-second timeout; each worker startup attempt has a two-minute timeout. Failed rounds retry automatically with capped exponential backoff. The UI keeps saved amounts visible throughout. The bootstrap provider sees discovery, and each RPC operator sees its wallet queries. Tor keys isolate circuits and TLS sessions but can randomly share an exit. The app trusts the bootstrap RPC, on-chain worker hash and selected worker implementation.

No analytics, external fonts, address links, address URL parameters or address logging are added. A referrer policy prevents outgoing referrers. Wallets and cached balances are intentionally stored in this browser; anyone with access to its storage can read them.

## Verification

`bun run test:all` runs the deterministic suite, production build and Chromium checks, including a fully offline production reload. Browser scenarios cover local validation, bulk additions, custom tokens and decimals, spinners, request status, cached balances, stale refreshes, recovery, storage failures, removals, persistence automatic retry recovery, offline pause/resume, cancellation, and mobile layout. Retry scheduler tests verify capped backoff and prevent duplicate work. Transport tests check exact calldata, latest tags, no batches, distinct keys, private retries, partial completion and blocked CCIP redirects. Static-server tests check content, headers, HEAD, missing files, invalid methods and path traversal.

The [GitHub Actions workflow](.github/workflows/test.yml) tests Bun 1.3.14 and 1.4.3 with locked installs. Failed browser checks retain screenshots, traces and HTML reports.

Live mainnet tests remain opt-in because they depend on external gateway, RPC and Tor availability. To test the production build:

```sh
bun run build
BASE_URL=http://127.0.0.1:4173 bun run test:live
```

The test runner starts the static server if needed. Deterministic UI tests replace the connection boundary only in Playwright; the production app has no mock mode.

References: [Anon-RPC web integration](https://ethereum.github.io/anon-rpc/wallets/), [tor-js circuit isolation](https://github.com/ethereum/tor-js#circuit-isolation), and [browser harness](https://github.com/ethereum/anon-rpc/tree/main/impl/browser-harness).
