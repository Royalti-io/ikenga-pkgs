#!/usr/bin/env bash
# Build the com.ikenga.studio MCP server as a node-runnable ESM bundle
# with a #!/usr/bin/env node shebang.
#
# DO NOT use `bun --compile` (Round 8 / G18, see plans/studio/08-tsserver-stdin-eof-bug.md):
#  - compiled bun sets process.execPath to the bundle, so spawn('node', …)
#    cannot resolve the system binary — the MCP spawns the sidecar via node;
#  - piped-stdin handling is flaky under compiled bun, and this MCP reads
#    JSON-RPC frames from stdin (its own MCP transport), so frames would
#    silently drop.

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
# @modelcontextprotocol/sdk is pure JS; bundle it. better-sqlite3 / chokidar
# are NOT touched by the MCP — only the sidecar opens those — so no need
# to mark them external here.
bun build $WATCH_FLAG \
  --target=node \
  --format=esm \
  --external @modelcontextprotocol/sdk \
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
