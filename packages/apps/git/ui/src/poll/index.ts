// com.ikenga.git · freshness (D7, WP-06 half)
//
// D7 (locked R2, re-scoped R4): push is primary — WP-05's MCP watcher emits a
// coalesced `repo.changed` notification, relayed by the shell into this
// iframe (app/bridge.ts's `onRepoChanged`). This module owns the OTHER half:
// one poll on mount (the fallback for a shell too old to relay, or before
// WP-05/WP-12 land), plus the subscription wiring so a view only has to call
// `watchProjectFreshness(onStale)` once.
//
// Never a tight interval poll — that reintroduces the `index.lock` /
// `tsc --watch` interference risk WATCH_FALLBACK_POLL_MS exists to avoid
// (rpc.ts §5.1). This module does not implement that slow fallback timer
// itself (that is the sidecar's job, per rpc.ts); it only guarantees the one
// mount-time fetch and reacts to whatever pushes arrive.

import { onRepoChanged } from '../app/bridge';

export type StaleReason = 'mount' | 'push';

/**
 * Fires `onStale('mount')` once immediately (the fallback poll-once-on-mount)
 * and again every time a `repo.changed` notification for ANY repo arrives
 * (`onStale('push')`) — the caller re-fetches whichever repo(s) it cares
 * about; this module doesn't scope by repo path itself; `RpcClient` calls are
 * cheap enough (one-shot sidecar spawn) that a project-wide re-scan on any
 * push is acceptable at Phase-1 scale (single-digit repos).
 *
 * Returns an unsubscribe fn.
 */
export function watchProjectFreshness(onStale: (reason: StaleReason) => void): () => void {
  // Poll-once-on-mount fallback.
  queueMicrotask(() => onStale('mount'));

  // D7 push subscription.
  const unsubscribe = onRepoChanged(() => onStale('push'));

  return unsubscribe;
}
