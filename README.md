# Anonfolio

A standalone Bun, Vite and TypeScript Ethereum mainnet balance reader. Paste an address to watch its ETH and WETH balances without connecting a wallet.

## Run

Install [Bun](https://bun.sh), then:

```sh
bun install --frozen-lockfile
bun run dev                  # http://localhost:5173
bun run test                 # balance, storage and static-server tests
bunx playwright install chromium
bun run test:browser         # Chromium UI tests with a simulated private worker
bun run test:all             # deterministic tests, build and production smoke check
bun run test:live            # real tor-js worker + mainnet; needs WebRTC/network access
bun run build               # type-check and produce dist/
bun run serve               # simple Bun static server, http://localhost:4173
```

Set `HOST` and `PORT` to change the static server's bind address and port. The server serves only `dist/`; it is not an RPC proxy. It returns 404 for absent assets and accepts only GET and HEAD.

To run live browser checks against the production build:

```sh
bun run build
BASE_URL=http://127.0.0.1:4173 bun run test:live
```

The test runner starts the static server if it is not already running. Live tests depend on the public gateway, RPC operators and Tor. The deterministic browser tests inject a fake connection boundary only in the test runner; the production app has no mock mode.

## Deployment

Upload the contents of `dist/` to a static **HTTPS** host. No backend, wallet extension, API key or special routing rules are required. Localhost works for development. For a subdirectory deployment, build with `bun run build --base=/your-path/`.

Copy `.env.example` to `.env.local` before building to customize:

| Variable | Purpose |
| --- | --- |
| `VITE_BOOTSTRAP_RPC` | Public mainnet HTTPS RPC used only to resolve the worker specifier at startup. |
| `VITE_ANON_GATEWAYS` | Comma-separated KPS gateway entries, each `ip:port:certhash`. |
| `VITE_RPC_URLS` | Comma-separated mainnet HTTPS RPC endpoints, preferably different operators. |

The shipped gateway is the **development demo gateway** from the official guide, with limited capacity and availability. Run your own tor-js gateway for deployment and rebuild with its entry. All `VITE_*` settings are public bundle contents; do not put secrets there. Endpoints must be Ethereum mainnet; the app does not add a chain-ID request to each balance read.

The default operators are PublicNode, dRPC and Ankr. Some public endpoints reject Tor exits or require credentials; replace unavailable operators in configuration. A wallet uses an unused endpoint when available, then reuses configured endpoints when the watchlist exceeds the pool.

The harness uses its default sandboxed srcdoc iframe and blob worker. If your host adds a strict Content Security Policy, follow the harness README's same-origin `iframeUrl` bootstrap workflow, or permit its required inline/worker capabilities. Do not apply a policy that silently prevents its bootstrap. Browser WebRTC/KPS connectivity is required.

## Routing and balance semantics

- One long-lived `AnonRpcWorker` uses the mainnet tor-js specifier `0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e`.
- Only public worker discovery uses the bootstrap client. The harness fetches and hash-verifies the published worker bundle. Watched addresses never enter that client.
- Each wallet receives a cryptographically random UUID isolation key and a dedicated viem HTTP client. Every request uses `worker.fetch` with that wallet's `anonOptions.isolationKey`. Keys persist for the life of the in-memory wallet, including refresh and retry; reloading creates new keys.
- HTTP batching, multicall and CCIP off-chain lookup redirects are disabled. No direct-fetch or public-RPC fallback exists. Viem retries once on the same endpoint and isolation key.
- ETH uses `getBalance({ address, blockTag: 'latest' })`. WETH uses `readContract` with `erc20Abi`, `balanceOf(address)`, `blockTag: 'latest'` and mainnet WETH `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`.
- Both values use exact bigint formatting with 18 decimals of precision, without floating-point rounding; insignificant trailing zeros are omitted. A successful zero displays `0`; an unread amount displays `—`.
- The two latest calls are independent and can observe different blocks. These are the RPC operator's returned values, not independently verified balances.
- Each token retains its last successful amount and timestamp if its refresh fails, with a stale label. A failed first lookup shows an error. Refresh retries just that wallet. A failed worker can be re-created with “Retry connection”; subsequent wallet retries retain their original keys.
- Requests have a 90-second timeout and one private retry; worker startup has a two-minute timeout. First reads can take longer than later refreshes.

## Local data and privacy

The watchlist stores **only addresses** in this browser's localStorage. Balances, timestamps and isolation keys stay in memory. Reloading refreshes wallets independently. Removing a wallet updates browser storage. If storage is blocked, the app keeps working and displays a warning when saving fails.

No analytics, external fonts, address links, address URL parameters or address logging are added. A referrer policy prevents outgoing referrers. The bootstrap provider sees worker discovery, and the selected RPC operator sees its wallet query. Tor isolation separates wallet circuits and TLS sessions, but different keys can randomly use the same exit. The app trusts the bootstrap RPC, on-chain worker hash and selected worker implementation.

## Verification

Run `bun run test:all` for the full deterministic suite. It runs Bun tests, type-checks and builds the app, then runs Chromium UI tests and a production static-host smoke test. Install Chromium once with `bunx playwright install chromium` (on Linux CI use `--with-deps`).

The [GitHub Actions template](docs/ci-workflow.yml) runs this suite for pull requests and pushes to main using a locked dependency install. Copy it to `.github/workflows/test.yml` to activate it; pushing that path requires GitHub workflow permission, which the current token lacks. Failed browser runs retain screenshots, traces and an HTML report as artifacts. Live mainnet tests remain opt-in because they depend on external gateway and Tor availability.

Storage regression tests cover malformed data, checksum normalization, duplicate addresses, blocked storage and quota failures. Static-server integration tests start the real Bun service against isolated fixtures and check HTML/assets, MIME and privacy headers, HEAD responses, missing files, rejected methods, traversal attempts, malformed paths and a missing build.


Transport tests inspect exact methods, `latest` block tags, WETH calldata, non-batched bodies, distinct isolation keys, retained stale values, partial failures, private retries and blocked CCIP redirects. They make ordinary fetch throw.

Chromium tests exercise local validation, zero results, manual refresh, RPC failure, stale results, recovery, independent wallet states, duplicate prevention, removal, persistence, route keys, separate operators and mobile overflow. Live Chromium tests exercise the actual worker, mainnet ETH/WETH, a second zero-balance address and refresh, and fail if ordinary browser requests contain balance RPC calls.

References: [Anon-RPC web integration guide](https://ethereum.github.io/anon-rpc/wallets/), [tor-js circuit isolation](https://github.com/ethereum/tor-js#circuit-isolation), and [browser harness](https://github.com/ethereum/anon-rpc/tree/main/impl/browser-harness).
