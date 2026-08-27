// com.ikenga.git · view skeletons (WP-06)
//
// Minimal renderers for all five side-menu sections so the shell reaches
// every route without a blank pane. This is deliberately NOT the designed
// Changes view (D-01, `designs/changes-instrument.html`) — that ledger/rail/
// inspector layout, the diff component, and the commit box are WP-07/WP-08/
// WP-09/WP-10. What's here: real repo-tree data from the (mocked or real)
// sidecar, dirty counts, a plain file/commit/branch list, and the no-root
// states wired in (states/index.ts) — enough to prove the shell + RPC + menu
// + theme plumbing end-to-end.

import type { BranchInfo, FileChange, ProjectRollup, RepoSnapshot, WorktreeInfo } from '../app/rpc';
import { VOCAB } from '../vocabulary';

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ── Changes ─────────────────────────────────────────────────────────────

export function renderChangesTree(rollup: ProjectRollup, activeRepo: string, onSelect: (repo: string) => void): HTMLElement {
  const root = el('div', 'git-tree');
  for (const repo of rollup.repos) {
    root.appendChild(renderRepoRow(repo, repo.repo === activeRepo, onSelect));
  }
  if (rollup.truncated) {
    root.appendChild(el('div', 'git-tree__truncated', VOCAB.states.truncated));
  }
  return root;
}

function renderRepoRow(repo: RepoSnapshot, active: boolean, onSelect: (repo: string) => void): HTMLElement {
  const row = el('div', `git-tree__row${active ? ' git-tree__row--active' : ''}`);
  row.setAttribute('role', 'button');
  row.tabIndex = 0;
  row.style.paddingLeft = `${repo.relPath === '.' ? 0 : 16}px`;

  const name = el('span', 'git-tree__name', repo.name);
  row.appendChild(name);

  const branch = el('span', 'git-tree__branch', repo.branch ?? '(detached)');
  row.appendChild(branch);

  const dirty = repo.staged + repo.unstaged + repo.untracked;
  if (dirty > 0) row.appendChild(el('span', 'git-tree__dirty', String(dirty)));

  if (repo.ahead !== null && repo.behind !== null && (repo.ahead > 0 || repo.behind > 0)) {
    const ab = el('span', 'git-tree__ahead-behind');
    if (repo.ahead > 0) ab.appendChild(el('span', 'git-tree__ahead', `+${repo.ahead}`));
    if (repo.behind > 0) ab.appendChild(el('span', 'git-tree__behind', `-${repo.behind}`));
    row.appendChild(ab);
  }

  const onClick = () => onSelect(repo.repo);
  row.addEventListener('click', onClick);
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') onClick();
  });

  return row;
}

export function renderChangesLists(staged: FileChange[], unstaged: FileChange[], untracked: FileChange[]): HTMLElement {
  const root = el('div', 'git-changes-lists');
  root.appendChild(renderFileGroup(VOCAB.changes.staged, staged));
  root.appendChild(renderFileGroup(VOCAB.changes.unstaged, unstaged));
  root.appendChild(renderFileGroup(VOCAB.changes.untracked, untracked));
  if (staged.length + unstaged.length + untracked.length === 0) {
    root.appendChild(el('div', 'git-empty-inline', VOCAB.changes.noChanges));
  }
  return root;
}

function renderFileGroup(title: string, files: FileChange[]): HTMLElement {
  const group = el('div', 'git-file-group');
  if (files.length === 0) return group;
  group.appendChild(el('div', 'git-file-group__title', `${title} (${files.length})`));
  const list = el('ul', 'git-file-group__list');
  for (const f of files) {
    const li = el('li', 'git-file-row');
    li.appendChild(el('span', 'git-file-row__path', f.path));
    if (f.added !== null || f.deleted !== null) {
      const stat = el('span', 'git-file-row__stat');
      if (f.added !== null) stat.appendChild(el('span', 'git-file-row__added', `+${f.added}`));
      if (f.deleted !== null) stat.appendChild(el('span', 'git-file-row__deleted', `-${f.deleted}`));
      li.appendChild(stat);
    } else if (f.binary) {
      li.appendChild(el('span', 'git-file-row__stat', 'binary'));
    }
    list.appendChild(li);
  }
  group.appendChild(list);
  return group;
}

// ── History ─────────────────────────────────────────────────────────────
// Superseded by WP-08: `views/history/` owns the real view (paginated log,
// forbidden-columns graph rail, commit detail, attribution). The skeleton
// list that lived here is gone rather than left dead.

// ── Branches ────────────────────────────────────────────────────────────

export function renderBranches(branches: BranchInfo[]): HTMLElement {
  const list = el('ul', 'git-branch-list');
  for (const b of branches) {
    const li = el('li', `git-branch-row${b.isHead ? ' git-branch-row--current' : ''}`);
    li.appendChild(el('span', 'git-branch-row__name', b.name));
    if (b.isHead) li.appendChild(el('span', 'git-branch-row__tag', VOCAB.branches.current));
    if (b.upstream) {
      const ab = el('span', 'git-branch-row__ab');
      if (b.ahead) ab.appendChild(el('span', 'git-branch-row__ahead', `+${b.ahead}`));
      if (b.behind) ab.appendChild(el('span', 'git-branch-row__behind', `-${b.behind}`));
      if (!b.ahead && !b.behind) ab.textContent = '·';
      li.appendChild(ab);
    } else {
      li.appendChild(el('span', 'git-branch-row__no-upstream', VOCAB.branches.noUpstream));
    }
    if (b.worktreePath) li.appendChild(el('span', 'git-branch-row__inuse', VOCAB.branches.inWorktree));
    list.appendChild(li);
  }
  return list;
}

// ── Worktrees ───────────────────────────────────────────────────────────

export function renderWorktrees(worktrees: WorktreeInfo[]): HTMLElement {
  const list = el('ul', 'git-worktree-list');
  for (const w of worktrees) {
    const li = el('li', 'git-worktree-row');
    li.appendChild(el('span', 'git-worktree-row__path', w.path));
    li.appendChild(el('span', 'git-worktree-row__branch', w.branch ?? '(detached)'));
    if (w.isMain) li.appendChild(el('span', 'git-worktree-row__tag', VOCAB.worktrees.main));
    if (w.locked) li.appendChild(el('span', 'git-worktree-row__tag', VOCAB.worktrees.locked));
    if (w.prunable) li.appendChild(el('span', 'git-worktree-row__tag', VOCAB.worktrees.prunable));
    list.appendChild(li);
  }
  return list;
}

// ── PRs (Phase 3 stub) ─────────────────────────────────────────────────

export function renderPrs(gh: { present: boolean; authenticated: boolean } | null): HTMLElement {
  const root = el('div', 'git-prs-stub');
  if (!gh || !gh.present) {
    root.appendChild(el('div', 'git-empty-inline', VOCAB.prs.ghMissing));
  } else if (!gh.authenticated) {
    root.appendChild(el('div', 'git-empty-inline', VOCAB.prs.ghUnauthenticated));
  } else {
    root.appendChild(el('div', 'git-empty-inline', VOCAB.prs.comingSoon));
  }
  return root;
}
