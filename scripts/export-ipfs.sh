#!/bin/sh
# Sealwort's host-neutral CAR release flow, shared by CI and the local check.
set -eu
BUILD_CID=$(cat "${IPFS_BUILD_CID_FILE:-/ipfs_hash.txt}")
EXPORT_DIRECTORY="${IPFS_EXPORT_DIR:-/export}"
OUTPUT_DIRECTORY="${IPFS_ARTIFACT_DIR:-/output}"
mkdir -p "$OUTPUT_DIRECTORY"
IPFS_HASH=$(ipfs add --cid-version 1 --quieter --recursive "$EXPORT_DIRECTORY")
if [ "$IPFS_HASH" != "$BUILD_CID" ]; then
  echo "IPFS CID mismatch: build contains $BUILD_CID but CAR was built from $IPFS_HASH" >&2
  exit 1
fi
ipfs dag export "$IPFS_HASH" > "$OUTPUT_DIRECTORY/anonfolio.car"
printf '%s\n' "$IPFS_HASH" > "$OUTPUT_DIRECTORY/ipfs-cid.txt"
echo "Exported IPFS artifact: $IPFS_HASH"
