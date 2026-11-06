# Running the production gateway pool

The upstream public address is a development demo, not a redundant production
service. Additional production addresses cannot be fabricated: run these steps
on at least two hosts in different providers/regions, or obtain addresses from
operators you trust. Anonfolio does not provision servers or create cloud bills.

Use the pinned tor-js source commit (the app separately pins the 0.4.4 worker bytes):

```sh
git clone https://github.com/ethereum/tor-js.git
cd tor-js
git checkout d9d9612d10d3775ff100b70e96a291718191d856
# Install Rust 1.91+ and the build dependencies described by upstream.
cargo install --locked --path crates/tor-js-gateway
tor-js-gateway init
tor-js-gateway install
```

Open/forward UDP port 12298. Set `advertised_addresses` for hosts behind NAT.
Keep the generated KPS identity key and data directory on persistent storage.
Each server prints its own `ip:port:certhash`; copy the complete strings into
Settings → Network connection → Tor gateways, one per line, or ship them with:

```sh
VITE_ANON_GATEWAYS='FIRST_REAL_IP:12298:FIRST_REAL_CERT_HASH,SECOND_REAL_IP:12298:SECOND_REAL_CERT_HASH' bun run build
```

The strings above are placeholders, not usable public servers. Do not use the
example IP addresses from upstream documentation as production endpoints.
Tor-js treats the list as a pool, distributes connections, and backs off failed
gateways. This app passes the entire pool to the single pinned Tor worker.
A blocked WebRTC/UDP network can still prevent every gateway from working.

## Publish the public directory mirror

After the gateway generates its snapshot, run from the Anonfolio checkout:

```sh
bun run bootstrap:update "$HOME/.local/share/tor-js-gateway/bootstrap.zip.zst"
bun run build
```

This writes a content-addressed archive and `tor-bootstrap.json` under `public/`;
Vite copies them into `dist/`. The app tries this same-origin manifest first,
with an eight-second total budget, a six-hour freshness limit, an 8 MiB archive
limit and a SHA-256 integrity check. Arti still verifies directory signatures.
Missing, stale, oversized or corrupted mirrors fall back to saved directory data
and the configured gateways. They never enable direct Ethereum RPC requests.

For an HTTPS deployment, run the command hourly with the static document root as
the optional second argument, **after** the gateway has refreshed its archive.
The manifest is atomically replaced after its content-addressed archive exists.
Serve the manifest with `Cache-Control: no-store` and the archives as immutable;
retain old archives long enough for clients already loading them. Only these
public directory files need to be mirrored; never publish gateway identity keys.
You can point `VITE_TOR_BOOTSTRAP_URL` or the Settings mirror URL at a separately
maintained HTTPS manifest with CORS enabled. Its archive must share that origin.

An immutable IPFS release cannot keep its embedded snapshot fresh indefinitely.
Republish periodically or configure a maintained HTTPS mirror; otherwise the app
ignores the old snapshot and uses its ordinary Tor bootstrap. An hourly job and
a reachable host are operator responsibilities, not something a static page can
run for itself.

Monitor actual browser WebRTC bootstrap from multiple networks, archive age,
gateway service restarts and Tor guard-connect failures. A successful HTTP ping
does not demonstrate that a KPS/WebRTC gateway works.

Upstream deployment guide: https://github.com/ethereum/tor-js/blob/main/crates/tor-js-gateway/README.md
