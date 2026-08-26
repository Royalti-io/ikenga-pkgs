// com.ikenga.git · view <-> route mapping (WP-06)
//
// manifest.json registers five top-level nav entries, each pointing at this
// SAME bundle (`ui/dist/index.html`) with a different path. Deep-linking
// therefore follows the agent-ops sub-route pattern (memory
// `reference_pkg_subroute_deeplinks`), not the simpler tasks single-route
// pattern the WP-06 spec's "(tasks pattern)" note refers to for activeFeature
// bookkeeping only — the pathname read is the piece tasks doesn't need
// (it registers exactly one route) and agent-ops does.

export type ViewId = 'changes' | 'history' | 'branches' | 'worktrees' | 'prs';

export const VIEW_IDS: readonly ViewId[] = ['changes', 'history', 'branches', 'worktrees', 'prs'];

const PATH_BY_VIEW: Record<ViewId, string> = {
  changes: '/pkg/com.ikenga.git/',
  history: '/pkg/com.ikenga.git/history',
  branches: '/pkg/com.ikenga.git/branches',
  worktrees: '/pkg/com.ikenga.git/worktrees',
  prs: '/pkg/com.ikenga.git/prs',
};

const VIEW_BY_SUFFIX: Record<string, ViewId> = {
  '': 'changes',
  history: 'history',
  branches: 'branches',
  worktrees: 'worktrees',
  prs: 'prs',
};

export function pathForView(view: ViewId): string {
  return PATH_BY_VIEW[view];
}

/** Parse a pane pathname like `/pkg/com.ikenga.git/history` down to its view
 *  suffix. Tolerant of a trailing slash and of not being a git pkg path at
 *  all (returns null so the caller can fall back). */
function suffixFromPathname(pathname: string): string | null {
  const marker = '/pkg/com.ikenga.git';
  const idx = pathname.indexOf(marker);
  if (idx === -1) return null;
  const rest = pathname.slice(idx + marker.length).replace(/^\/+/, '').replace(/\/+$/, '');
  return rest;
}

const LAST_VIEW_KEY = 'com.ikenga.git:lastView';

/** Same-origin read of the PARENT pane's pathname (works because the shell
 *  keeps browser history synced to the focused pane's route — srcdoc iframe,
 *  same-origin). Falls back to the last view persisted in localStorage, then
 *  to `'changes'`. Never throws. */
export function deriveInitialView(): ViewId {
  // Dev/QA override — same convention as `?scan=`/`?mock=1` (bridge.ts,
  // transport.ts): lets a bare browser tab exercise every view without a
  // real shell pane path to derive from (a static preview server has no
  // history-fallback story for `/pkg/com.ikenga.git/<view>` deep links).
  try {
    const forced = new URLSearchParams(window.location.search).get('view');
    if (forced && (VIEW_IDS as readonly string[]).includes(forced)) return forced as ViewId;
  } catch {
    // ignore — fall through to the real derivation
  }
  try {
    const pathname = window.parent?.location?.pathname;
    if (typeof pathname === 'string') {
      const suffix = suffixFromPathname(pathname);
      if (suffix !== null && suffix in VIEW_BY_SUFFIX) {
        return VIEW_BY_SUFFIX[suffix]!;
      }
    }
  } catch {
    // Cross-origin parent (shouldn't happen for a srcdoc-mounted pkg pane) —
    // fall through to the persisted/default view.
  }
  try {
    const stored = window.localStorage?.getItem(LAST_VIEW_KEY);
    if (stored && (VIEW_IDS as readonly string[]).includes(stored)) return stored as ViewId;
  } catch {
    // Storage may throw (private mode, blocked site data) — never fatal.
  }
  return 'changes';
}

export function persistView(view: ViewId): void {
  try {
    window.localStorage?.setItem(LAST_VIEW_KEY, view);
  } catch {
    // Best-effort only.
  }
}
