// Deterministic build for com.ikenga.agent-ops — WP-19 (runtime extraction).
//
// This pkg previously had `build: echo 'no build'`. It now vendors the shared
// no-build runtime (bridge + ui) from @ikenga/pkg-runtime, the single source of
// truth — killing its copy-pasted bridge.js/ui.js. agent-ops carries the extra
// `host.agentOps.*` cron verbs, so the 'agentops' bridge fragment is appended
// onto the shared core; pkg-id.js injects this pkg's source-id + log tag.
//
// DEFERRED to WP-20 (NOT done here): CSS codegen. Unlike the other app pkgs,
// agent-ops has NO source `.css` file — its four domain CSS-as-JS artifacts
// (agent-ops-css.js / -form-css.js / -live-css.js / -runs-css.js) are hand-
// authored from the D-01 mock, and its tokens-css.js is a hand-copied (slightly
// stale) vendor rather than a copy of @ikenga/tokens. Re-vendoring tokens-css
// and introducing a deterministic CSS codegen path (matching the sibling pkgs)
// is left to WP-20 so this pass changes only the runtime, not agent-ops CSS.
import { fileURLToPath } from 'node:url';
import { vendorRuntime } from '../../../lib/pkg-runtime/vendor.mjs';

// Vendor the shared no-build runtime (bridge + ui) + the agent-ops bridge fragment.
const runtime = vendorRuntime({
  destLibDir: fileURLToPath(new URL('../dist/lib', import.meta.url)),
  pkgId: 'com.ikenga.agent-ops',
  logTag: 'agent-ops',
  files: ['bridge', 'ui'],
  bridgeExt: 'agentops',
});

console.log('[agent-ops build] runtime: ' + runtime.join(', ') + ' (CSS codegen deferred to WP-20)');
