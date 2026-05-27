#!/usr/bin/env bash
# build.sh — compile the local-store-etl sidecar to a single executable.
# Usage: bash build.sh [--target <triple>]
#
# Produces dist/pa-com-ikenga-local-store-etl-main (native binary via bun build
# --compile). The output name matches the sidecar `bin` in manifest.json.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$ROOT/dist/pa-com-ikenga-local-store-etl-main"

mkdir -p "$ROOT/dist"

echo "[local-store-etl] building sidecar → $OUT"
bun build \
  --compile \
  --target bun \
  --outfile "$OUT" \
  "$ROOT/src/main.ts"

echo "[local-store-etl] done → $OUT"
