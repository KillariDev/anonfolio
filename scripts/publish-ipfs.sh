#!/bin/sh
# Adapted from Sealwort's Docker entrypoint (Unlicense).
set -eu
BUILD_CID=$(cat "${IPFS_BUILD_CID_FILE:-/ipfs_hash.txt}")
IPFS_API_ADDRESS="${IPFS_API_MULTIADDR:-/dns4/host.docker.internal/tcp/5001}"
EXPORT_DIRECTORY="${IPFS_EXPORT_DIR:-/export}"

echo "Build CID: $BUILD_CID"
echo "Publishing Anonfolio to Kubo at $IPFS_API_ADDRESS"
if ! PUBLISHED_CID=$(ipfs add \
    --api "$IPFS_API_ADDRESS" \
    --cid-version 1 \
    --pin=true \
    --quieter \
    --recursive \
    "$EXPORT_DIRECTORY"); then
  echo "Could not publish to Kubo at $IPFS_API_ADDRESS." >&2
  echo "A loopback-only host RPC listener is not reachable from Docker; see the README for configuration options." >&2
  exit 1
fi
if [ "$PUBLISHED_CID" != "$BUILD_CID" ]; then
  echo "Published CID $PUBLISHED_CID does not match build CID $BUILD_CID." >&2
  exit 1
fi
echo "Published CID: $PUBLISHED_CID"
echo "Local URL: http://$PUBLISHED_CID.ipfs.localhost:8080/"
