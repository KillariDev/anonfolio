# Adapted from DarkFlorist/Sealwort (Unlicense), revision bc67c11581a0dba371a7335fe0220d9dc47ef396.
FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS builder
WORKDIR /source
COPY package.json bun.lock tsconfig.json vite.config.ts index.html ./
RUN bun install --frozen-lockfile
COPY scripts/ scripts/
COPY src/ src/
COPY vendor/ vendor/
COPY tests/ tests/
COPY docs/ docs/
RUN bun --bun run build

FROM ipfs/kubo:v0.25.0@sha256:0c17b91cab8ada485f253e204236b712d0965f3d463cb5b60639ddd2291e7c52 AS ipfs-kubo
FROM debian:12.6-slim@sha256:39868a6f452462b70cf720a8daff250c63e7342970e749059c105bf7c1e8eeaf
COPY --from=ipfs-kubo /usr/local/bin/ipfs /usr/local/bin/ipfs
COPY --from=builder /source/dist /export
RUN ipfs init \
    && ipfs add --cid-version 1 --quieter --only-hash --recursive /export > /ipfs_hash.txt
COPY scripts/publish-ipfs.sh /entrypoint.sh
COPY scripts/export-ipfs.sh /export-ipfs.sh
RUN chmod 755 /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
