// com.ikenga.git · side-menu (WP-06)
//
// Publishes the Changes · History · Branches · Worktrees · PRs sections via
// `host.pkg.setMenu`. Click feedback comes back through
// `hostContext.royaltiSuite.activeFeature` (app/App.ts wires that). Publish is
// debounced (150ms trailing), matching studio's convention, so a burst of
// snapshot refreshes coalesces into at most one host call.

import { setMenu, type PublishedMenuItem } from '../app/bridge';
import type { ProjectRollup } from '../app/rpc';
import { VOCAB } from '../vocabulary';
import { pathForView, type ViewId } from '../app/routes';

const ICON: Record<ViewId, string> = {
  changes: 'git-branch',
  history: 'history',
  branches: 'git-fork',
  worktrees: 'layout-grid',
  prs: 'git-pull-request',
};

function totalDirty(rollup: ProjectRollup | null): number {
  if (!rollup) return 0;
  return rollup.repos.reduce((sum, r) => sum + r.staged + r.unstaged + r.untracked, 0);
}

function totalWorktrees(rollup: ProjectRollup | null): number {
  if (!rollup) return 0;
  return rollup.repos.reduce((sum, r) => sum + r.worktrees.length, 0);
}

export function buildMenuItems(activeView: ViewId, rollup: ProjectRollup | null): PublishedMenuItem[] {
  const dirty = totalDirty(rollup);
  const worktreeCount = totalWorktrees(rollup);

  const items: PublishedMenuItem[] = [
    {
      id: 'changes',
      label: VOCAB.nav.changes,
      icon: ICON.changes,
      section: VOCAB.section.source,
      badge: dirty > 0 ? dirty : null,
      active: activeView === 'changes',
    },
    {
      id: 'history',
      label: VOCAB.nav.history,
      icon: ICON.history,
      section: VOCAB.section.source,
      active: activeView === 'history',
    },
    {
      id: 'branches',
      label: VOCAB.nav.branches,
      icon: ICON.branches,
      section: VOCAB.section.source,
      active: activeView === 'branches',
    },
    {
      id: 'worktrees',
      label: VOCAB.nav.worktrees,
      icon: ICON.worktrees,
      section: VOCAB.section.source,
      badge: worktreeCount > 1 ? worktreeCount : null,
      active: activeView === 'worktrees',
    },
    {
      id: 'prs',
      label: VOCAB.nav.prs,
      icon: ICON.prs,
      section: VOCAB.section.source,
      active: activeView === 'prs',
    },
  ];
  return items;
}

let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _lastPublished: string | null = null;

export function publishMenu(activeView: ViewId, rollup: ProjectRollup | null): void {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    const items = buildMenuItems(activeView, rollup);
    const serialized = JSON.stringify(items);
    if (serialized === _lastPublished) return;
    _lastPublished = serialized;
    setMenu(items).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[git] setMenu failed', err);
    });
  }, 150);
}

export { pathForView };
export type { ViewId };
