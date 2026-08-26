// com.ikenga.git · no-root empty states (G-05) + repo picker (WP-06)
//
// Four named UI states, one per G-05 reason — never a throw, never a raw git
// error surfaced. `renderEmptyState` is also the DELTA-3 fallback: a
// `not-a-repository` reason with `rootIsRepo: false` on an otherwise-`ok`
// scan (root has nested repos but isn't itself one) reads the same as any
// other empty state until repos are picked from the tree, so it does not get
// its own reason code — the caller decides whether to show the tree instead.

import { VOCAB } from '../vocabulary';
import type { GitErrorReason, NestedRepo } from '../app/rpc';

export type EmptyStateReason = Extract<
  GitErrorReason,
  'no-project' | 'no-project-root' | 'not-a-repository' | 'unreadable'
>;

const COPY: Record<EmptyStateReason, { title: string; hint: string; command?: string }> = {
  'no-project': { title: VOCAB.states.noProject, hint: VOCAB.states.noProjectHint },
  'no-project-root': { title: VOCAB.states.noProjectRoot, hint: VOCAB.states.noProjectRootHint },
  'not-a-repository': {
    title: VOCAB.states.notARepository,
    hint: VOCAB.states.notARepositoryHint,
    // Q1 (rpc.ts DELTA 4): `repo.init` is deliberately absent from the RPC
    // surface — `init` isn't on git-core's subcommand allowlist (G-02). This
    // state offers a copyable command instead of a mutating call.
    command: VOCAB.states.notARepositoryCommand,
  },
  unreadable: { title: VOCAB.states.unreadable, hint: VOCAB.states.unreadableHint },
};

export function renderEmptyState(reason: EmptyStateReason): HTMLElement {
  const copy = COPY[reason];
  const el = document.createElement('div');
  el.className = 'git-empty-state';
  el.setAttribute('data-reason', reason);

  const title = document.createElement('div');
  title.className = 'git-empty-state__title';
  title.textContent = copy.title;
  el.appendChild(title);

  const hint = document.createElement('div');
  hint.className = 'git-empty-state__hint';
  hint.textContent = copy.hint;
  el.appendChild(hint);

  if (copy.command) {
    const cmdRow = document.createElement('div');
    cmdRow.className = 'git-empty-state__cmd-row';
    const code = document.createElement('code');
    code.className = 'git-empty-state__cmd';
    code.textContent = copy.command;
    cmdRow.appendChild(code);
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'git-btn git-btn--ghost';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard?.writeText(copy.command!).catch(() => {});
    });
    cmdRow.appendChild(copyBtn);
    el.appendChild(cmdRow);
  }

  return el;
}

/** Cross-repo staging guard (G-11) refusal card — always available as an
 *  inspector affordance, per the design reference (D-01). WP-06 renders the
 *  copy + jump action; WP-07/10 wire the actual re-stage. */
export function renderCrossRepoCard(path: string, ownerRepo: string, onJump: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'git-card git-card--warn';

  const title = document.createElement('div');
  title.className = 'git-card__title';
  title.textContent = VOCAB.states.crossRepoTitle;
  el.appendChild(title);

  const hint = document.createElement('div');
  hint.className = 'git-card__hint';
  hint.textContent = VOCAB.states.crossRepoHint(path, ownerRepo);
  el.appendChild(hint);

  const jump = document.createElement('button');
  jump.type = 'button';
  jump.className = 'git-btn';
  jump.textContent = VOCAB.states.crossRepoJump;
  jump.addEventListener('click', onJump);
  el.appendChild(jump);

  return el;
}

export interface RepoPickerEntry {
  repo: string;
  name: string;
  relPath: string;
  dirty: number;
}

/** Repo picker within the active project — the multi-repo model (G-11 / D2)
 *  makes "which repo am I acting on" an explicit choice, never ambient. */
export function renderRepoPicker(
  entries: RepoPickerEntry[],
  activeRepo: string | null,
  onSelect: (repo: string) => void
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'git-repo-picker';

  const label = document.createElement('span');
  label.className = 'git-repo-picker__label';
  label.textContent = VOCAB.repoPicker.label;
  wrap.appendChild(label);

  const select = document.createElement('select');
  select.className = 'git-repo-picker__select';
  for (const entry of entries) {
    const opt = document.createElement('option');
    opt.value = entry.repo;
    const rel = entry.relPath === '.' ? VOCAB.repoPicker.root : entry.relPath;
    opt.textContent = entry.dirty > 0 ? `${entry.name} (${rel}) · ${entry.dirty}` : `${entry.name} (${rel})`;
    if (entry.repo === activeRepo) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => onSelect(select.value));
  wrap.appendChild(select);

  return wrap;
}

export function nestedToPickerEntries(root: { repo: string; name: string; relPath: string; dirty: number }, nested: NestedRepo[], dirtyByRepo: Map<string, number>): RepoPickerEntry[] {
  return [
    root,
    ...nested.map((n) => ({ repo: n.repo, name: n.name, relPath: n.relPath, dirty: dirtyByRepo.get(n.repo) ?? 0 })),
  ];
}
