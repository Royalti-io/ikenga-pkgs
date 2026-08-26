#!/usr/bin/env bash
# Build the com.ikenga.git MCP server as a node-runnable ESM bundle with a
# `#!/usr/bin/env node` shebang.
#
# DO NOT use `bun --compile` (see the studio MCP's build.sh): a compiled bun
# sets process.execPath to the bundle, and this MCP reads JSON-RPC frames
# from stdin (its own MCP transport) — piped-stdin handling is flaky under
# compiled bun, which would silently drop frames.
set -euo pipefail

cd "$(dirname "$0")"

mkdir -p dist
OUTPUT="dist/index.js"
TMP="dist/.index.tmp.js"

WATCH_FLAG=""
if [[ "${1:-}" == "--watch" ]]; then
  WATCH_FLAG="--watch"
fi

echo "==> bundling $OUTPUT (target: node, format: esm)"
# @modelcontextprotocol/sdk and zod are kept as RUNTIME imports (--external
# below) so they resolve from the parent @ikenga/pkg-git pkg's hoisted
# node_modules — this MCP's own package.json declares no deps.
bun build $WATCH_FLAG \
  --target=node \
  --format=esm \
  --external @modelcontextprotocol/sdk \
  --external zod \
  src/index.ts \
  --outfile "$TMP"

# Prepend shebang — bun build doesn't add one for plain ESM outputs.
{
  echo '#!/usr/bin/env node'
  cat "$TMP"
} > "$OUTPUT"
rm "$TMP"
chmod +x "$OUTPUT"

echo "==> done: $(du -h "$OUTPUT" | cut -f1) $OUTPUT"
