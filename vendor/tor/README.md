# Pinned Tor worker

`anon-rpc-worker.js` is the unchanged `tor-js@0.4.4` browser anon-rpc bundle,
including its embedded WASM. Its Keccak-256 is:

```
0x5b62f358ce7a2b94ee9bc3a0e6a08757db68fa08fc348276f31eda788aec818b
```

This is the existing independently checked Tor pin in `src/config.ts` and
`vendor/helios/review.json`, originally compared with
<https://cdn.jsdelivr.net/npm/tor-js@0.4.4/dist/anon-rpc-worker.js>.
The vendored copy is byte-identical; Vite emits it as a raw URL asset, without
minification or module transformation. A unit test checks the source bytes,
and the Anon-RPC harness checks the fetched bytes before executing them.

`src/bootstrap.ts` supplies the specifier hash and same-origin bundle URL from
release metadata. Its provider answers only the two supported specifier calls
locally; it is not an Ethereum client. No runtime RPC discovery or external
resolver fallback is used. Updating the worker requires a reviewed release,
matching source pin and vendored bytes. It is also part of the offline/IPFS shell.

Upstream: <https://github.com/ethereum/tor-js>. Distributed under MIT OR
Apache-2.0; see `LICENSE-MIT` and `LICENSE-APACHE` in this directory.
