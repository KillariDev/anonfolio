# Reviewed Helios browser verifier

Vendored from `@a16z/helios@0.12.0`, upstream commit
`2af9b41887e069144ee56cd710f3ddca195473f8`, tag `0.12.0`.
MIT license: [LICENSE](LICENSE). Exact WASM SHA-256 and trust evidence:
[review.json](review.json).

Reviewed upstream boundaries:

- `core/src/execution/providers/rpc.rs::get_account`: binds `proof.address`
  to the requested address (PR #813), verifies the account against the trusted
  block state root, verifies storage proofs and requires every requested slot.
- The same function verifies bytecode against the proven account code hash.
- `ethereum/src/evm.rs`: pins local revm execution to a block hash and demand-loads
  missing verified state; dependencies discovered during proxy calls follow the
  same path. Remote access lists are hints, never trusted execution results.
- `core/src/client/node.rs::ensure_trusted_block_valid`: validates execution block
  headers and bodies against the execution hash authenticated by consensus.
- Execution calls await their proof, code and dependency requests. Only consensus
  block-cache updates run in background. This matters for the serialized wallet
  transport context in `src/verification/helios.worker.ts`.

The WASM binary is unchanged. `index.js` is the upstream wasm-bindgen glue with
one import added and its three WASM HTTP-fetch imports redirected to
`heliosFetch` in `fetch.js`. No main-thread/global fetch replacement is used.
Initialization receives already downloaded, SHA-256-checked WASM bytes.

The adapter only permits wallet execution HTTP via the main thread's explicit
Anon-RPC bridge. Consensus GETs use the pinned beacon origin and a restricted
path allowlist. Proofs, bytecode, retries and execution-block metadata all use
`worker.fetch` with the active wallet's original isolation key. Batches and
remote eth_call execution are forbidden. A response URL is supplied on synthetic
responses because reqwest's WASM adapter requires it.

One shared EthereumClient runs consensus, with a fixed independently pinned
checkpoint and in-memory database. Wallet refreshes execute serially; concurrent
refreshes queue, so all synchronous/asynchronous execution requests and retries
remain bound to one immutable wallet session. No proof or code request is
allowed without that session's verified finalized block. Background execution
metadata requests outside a wallet refresh are rejected; public beacon sync
continues. Header-cache lag is bounded to one hour and the exact finalized
block/time is shown. A fatal error terminates the worker and fails queued reads.

The checkpoint at slot 15589024 (2026-11-05 15:25:11 UTC) was compared with
PublicNode's finalized beacon header and independently with beaconcha.in,
Attestant and ChainSafe checkpointz slot lists. These independently observed
weak-subjectivity inputs are a deployment trust decision, not a new runtime
checkpoint-discovery protocol. Runtime settings and localStorage cannot replace
the checkpoint or either binary digest. An expired (>14-day) pin fails closed;
update it through a reviewed release, comparing independent operators again.

Updating Helios requires reviewing the corresponding proof, EVM, transport,
background-task and consensus changes, regenerating/verifying the upstream
WASM artifact, updating pins, and rerunning adversarial and real Tor tests.
