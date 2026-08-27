// com.ikenga.git · Changes view — lists + diff component (WP-07)
//
// Mounted by App.ts's `changes` case into the pane to the RIGHT of the
// existing multi-repo ledger (`renderChangesTree`, `views/index.ts` — WP-06,
// out of this WP's file scope). This module owns everything for the ACTIVE
// repo: staged / unstaged / untracked / conflicted lists, per-file and
// bulk stage/unstage, and the diff pane for whichever file is selected.
//
// ── D9 (diff library — locked here, WP-07) ──────────────────────────────────
// 01-plan.md tentatively favoured `@git-diff-view/react`. That doesn't fit:
// this pkg's UI is vanilla DOM/TS end to end (App.ts, views/branches,
// views/history — no framework anywhere, checked before writing this file),
// and the vite delivery contract for a pkg iframe is a SINGLE inlined chunk
// (memory `reference_vite_pkg_iframe_delivery`) — pulling in React plus a
// React-only diff component to satisfy one view would be the first framework
// dependency in the whole pkg for a feature a ~150-line parser covers
// (diff-parse.ts, tested — 2000 lines parses in ~3.6ms, DoD is <200ms).
// Locked: hand-rolled parser + renderer (diff-parse.ts / diff-render.ts),
// not a library. `changes.diff`'s `patch` field is unparsed unified text for
// exactly this reason (rpc.ts §3.8) — the sidecar was built expecting the UI
// to own this choice.
//
// ── Render loop ──────────────────────────────────────────────────────────
// Same shape as views/branches/index.ts: this module owns its own repaint
// loop into whatever `container` it's given, independent of App.ts's
// `setState` (App fully rebuilds its subtree on every state change, which
// would otherwise blow away in-flight diff loads and the selected file on
// every keystroke-adjacent repaint). No persistence across an App-level
// rescan (a `repo.changed` push, or switching repos and back) — same
// trade-off Branches already made; selection resets, which is acceptable
// because a rescan is what a stage/unstage of ours just caused anyway.
// Every async continuation guards with `alive()` before touching the DOM.

import type { FileChange, FileDiff, RpcClient } from '../../app/rpc';
import { VOCAB } from '../../vocabulary';
import { renderCrossRepoCard } from '../../states';
import { renderDiffEmpty, renderDiffSideBySide, renderDiffUnified } from './diff-render';
import { parsePatch } from './diff-parse';
import './changes.css';

export interface ChangesViewDeps {
  repo: string;
  rpc: RpcClient;
  /** Called after a stage/unstage mutation succeeds, so the host can re-scan
   *  the project (header dirty counts, the ledger, other views). */
  onChanged?: () => void;
  /** Called when a cross-repo guard's jump action is taken (G-11) — the host
   *  switches the active repo to the file's real owner. */
  onJumpToRepo?: (repo: string) => void;
}

type DiffMode = 'split' | 'unified';
type Section = 'staged' | 'unstaged' | 'untracked' | 'conflicted';

interface Selection {
  section: Section;
  file: FileChange;
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, className: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.disabled = disabled;
  btn.addEventListener('click', onClick);
  return btn;
}

function fileKey(f: FileChange): string {
  return f.path;
}

/** Mounts (and fully owns) the Changes lists + diff pane into `container`. */
export function mountChangesView(container: HTMLElement, deps: ChangesViewDeps): void {
  const { repo, rpc } = deps;

  let staged: FileChange[] = [];
  let unstaged: FileChange[] = [];
  let untracked: FileChange[] = [];
  let conflicted: FileChange[] = [];
  let loading = true;
  let loadError: string | null = null;

  let selection: Selection | null = null;
  let diffMode: DiffMode = 'split';
  let diff: FileDiff | null = null;
  let diffLoading = false;
  let diffError: string | null = null;
  /** Bumped on every diff fetch so a slow, superseded response is dropped
   *  instead of clobbering a newer selection's result. */
  let diffToken = 0;

  let mutating = false;
  let mutateError: string | null = null;
  let crossRepoGuard: { path: string; ownerRepo: string } | null = null;

  function alive(): boolean {
    return container.isConnected;
  }

  function repaint(): void {
    if (!alive()) return;
    container.innerHTML = '';
    container.appendChild(build());
  }

  function allFiles(): FileChange[] {
    return [...staged, ...unstaged, ...untracked, ...conflicted];
  }

  async function load(): Promise<void> {
    loading = true;
    loadError = null;
    repaint();
    try {
      const res = await rpc('changes.list', { repo });
      if (!alive()) return;
      loading = false;
      if (!res.ok) {
        loadError = res.message;
        staged = [];
        unstaged = [];
        untracked = [];
        conflicted = [];
        repaint();
        return;
      }
      staged = res.staged;
      unstaged = res.unstaged;
      untracked = res.untracked;
      conflicted = res.conflicted;
      // Keep the selection if that file is still present in some section;
      // otherwise fall back to the first available file (prefer conflicted,
      // then staged, then unstaged) so the pane isn't blank after a mutation.
      const stillThere = selection && allFiles().find((f) => fileKey(f) === fileKey(selection!.file));
      if (stillThere) {
        selection = { section: selection!.section, file: stillThere };
      } else {
        selection = firstSelectable();
      }
      repaint();
      if (selection) void loadDiff(selection);
    } catch (err) {
      if (!alive()) return;
      loading = false;
      loadError = err instanceof Error ? err.message : String(err);
      repaint();
    }
  }

  function firstSelectable(): Selection | null {
    if (conflicted.length > 0) return { section: 'conflicted', file: conflicted[0]! };
    if (staged.length > 0) return { section: 'staged', file: staged[0]! };
    if (unstaged.length > 0) return { section: 'unstaged', file: unstaged[0]! };
    if (untracked.length > 0) return { section: 'untracked', file: untracked[0]! };
    return null;
  }

  function select(section: Section, file: FileChange): void {
    selection = { section, file };
    diff = null;
    diffError = null;
    crossRepoGuard = null;
    repaint();
    void loadDiff(selection);
  }

  async function loadDiff(sel: Selection): Promise<void> {
    // Untracked files have no index entry, so `git diff` (staged or
    // unstaged) has nothing to compare against — `DiffSideSchema` has no
    // "untracked" member for exactly that reason (rpc.ts §3.8). Show the
    // named state instead of calling an RPC that can't answer it.
    if (sel.section === 'untracked') {
      diff = null;
      diffLoading = false;
      diffError = null;
      repaint();
      return;
    }
    const side = sel.section === 'staged' ? 'staged' : 'unstaged';
    const token = ++diffToken;
    diffLoading = true;
    diffError = null;
    repaint();
    try {
      const res = await rpc('changes.diff', { repo, path: sel.file.path, side });
      if (!alive() || token !== diffToken) return;
      diffLoading = false;
      if (!res.ok) {
        diffError = res.message;
        diff = null;
      } else {
        diff = res.diff;
      }
      repaint();
    } catch (err) {
      if (!alive() || token !== diffToken) return;
      diffLoading = false;
      diffError = err instanceof Error ? err.message : String(err);
      repaint();
    }
  }

  async function mutate(kind: 'stage' | 'unstage', paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    mutating = true;
    mutateError = null;
    crossRepoGuard = null;
    repaint();
    try {
      const res = await rpc(kind === 'stage' ? 'changes.stage' : 'changes.unstage', { repo, paths });
      if (!alive()) return;
      mutating = false;
      if (res.ok) {
        deps.onChanged?.();
        await load();
        return;
      }
      if (res.reason === 'cross-repo-path' && res.path && res.ownerRepo) {
        crossRepoGuard = { path: res.path, ownerRepo: res.ownerRepo };
        repaint();
        return;
      }
      mutateError = res.message;
      repaint();
    } catch (err) {
      if (!alive()) return;
      mutating = false;
      mutateError = err instanceof Error ? err.message : String(err);
      repaint();
    }
  }

  // ── Build ──────────────────────────────────────────────────────────────

  function build(): HTMLElement {
    const root = el('div', 'git-changes');
    root.appendChild(buildLists());
    root.appendChild(buildInspector());
    return root;
  }

  function buildLists(): HTMLElement {
    const wrap = el('div', 'git-changes__lists');

    if (loading && allFiles().length === 0) {
      wrap.appendChild(el('div', 'git-empty-inline', VOCAB.common.loading));
      return wrap;
    }
    if (loadError) {
      wrap.appendChild(buildRetryBanner(loadError, () => void load()));
    }
    if (allFiles().length === 0 && !loading) {
      wrap.appendChild(el('div', 'git-empty-inline', VOCAB.changes.noChanges));
      return wrap;
    }

    if (conflicted.length > 0) {
      wrap.appendChild(buildSection('conflicted', '', conflicted, null, VOCAB.changes.conflicted));
    }
    wrap.appendChild(
      buildSection(
        'staged',
        VOCAB.changes.unstage,
        staged,
        staged.length > 1
          ? { label: `${VOCAB.changes.unstage} all ${String(staged.length)}`, onClick: () => void mutate('unstage', staged.map((f) => f.path)) }
          : null,
        VOCAB.changes.staged
      )
    );
    wrap.appendChild(
      buildSection(
        'unstaged',
        VOCAB.changes.stage,
        unstaged,
        unstaged.length > 1
          ? { label: `${VOCAB.changes.stageAll} ${String(unstaged.length)}`, onClick: () => void mutate('stage', unstaged.map((f) => f.path)) }
          : null,
        VOCAB.changes.unstaged
      )
    );
    wrap.appendChild(
      buildSection(
        'untracked',
        VOCAB.changes.stage,
        untracked,
        untracked.length > 1
          ? { label: `${VOCAB.changes.stageAll} ${String(untracked.length)}`, onClick: () => void mutate('stage', untracked.map((f) => f.path)) }
          : null,
        VOCAB.changes.untracked
      )
    );

    return wrap;
  }

  function buildSection(
    section: Section,
    actionLabel: string,
    files: FileChange[],
    bulk: { label: string; onClick: () => void } | null,
    title?: string
  ): HTMLElement {
    const group = el('div', 'git-file-group');
    if (files.length === 0) return group;

    const head = el('div', 'git-file-group__title');
    head.appendChild(document.createTextNode(`${title ?? section} (${String(files.length)})`));
    if (bulk) {
      const btn = button(bulk.label, 'git-btn git-btn--ghost git-changes__bulk', bulk.onClick, mutating);
      head.appendChild(btn);
    }
    group.appendChild(head);

    const list = el('ul', 'git-file-group__list');
    for (const f of files) list.appendChild(buildFileRow(section, f, actionLabel));
    group.appendChild(list);
    return group;
  }

  function buildFileRow(section: Section, f: FileChange, actionLabel: string): HTMLElement {
    const isSel = selection?.section === section && fileKey(selection.file) === fileKey(f);
    const li = el('li', `git-file-row git-file-row--clickable${isSel ? ' git-file-row--active' : ''}`);
    li.setAttribute('role', 'button');
    li.tabIndex = 0;

    const path = el('span', 'git-file-row__path');
    if (f.kind === 'renamed' || f.kind === 'copied') {
      path.appendChild(el('span', 'git-file-row__rename-tag', f.kind === 'renamed' ? 'R' : 'C'));
    }
    path.appendChild(document.createTextNode(f.path));
    li.appendChild(path);

    if (f.binary) {
      li.appendChild(el('span', 'git-file-row__stat git-file-row__stat--binary', 'binary'));
    } else if (f.added !== null || f.deleted !== null) {
      const stat = el('span', 'git-file-row__stat');
      if (f.added !== null && f.added > 0) stat.appendChild(el('span', 'git-file-row__added', `+${String(f.added)}`));
      if (f.deleted !== null && f.deleted > 0) stat.appendChild(el('span', 'git-file-row__deleted', `-${String(f.deleted)}`));
      li.appendChild(stat);
    }

    if (section !== 'conflicted') {
      const btn = button(
        actionLabel,
        'git-btn git-btn--ghost git-btn--sm',
        () => void mutate(section === 'staged' ? 'unstage' : 'stage', [f.path]),
        mutating
      );
      // Row click selects the file (for the diff pane); the action button
      // sits inside the row, so its click must not also fire the row's
      // select handler.
      btn.addEventListener('click', (ev) => ev.stopPropagation());
      li.appendChild(btn);
    }

    const onClick = () => select(section, f);
    li.addEventListener('click', onClick);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') onClick();
    });

    return li;
  }

  function buildRetryBanner(message: string, onRetry: () => void): HTMLElement {
    const card = el('div', 'git-card git-card--warn');
    card.appendChild(el('div', 'git-card__hint', message));
    card.appendChild(button(VOCAB.common.retry, 'git-btn git-btn--ghost', onRetry));
    return card;
  }

  function buildInspector(): HTMLElement {
    const wrap = el('div', 'git-changes__inspector');

    if (mutateError) {
      wrap.appendChild(
        buildRetryBanner(mutateError, () => {
          mutateError = null;
          repaint();
        })
      );
    }
    if (crossRepoGuard) {
      wrap.appendChild(
        renderCrossRepoCard(crossRepoGuard.path, crossRepoGuard.ownerRepo, () => {
          const owner = crossRepoGuard!.ownerRepo;
          crossRepoGuard = null;
          deps.onJumpToRepo?.(owner);
        })
      );
    }

    if (!selection) {
      wrap.appendChild(el('div', 'git-empty-inline', VOCAB.changes.selectFileHint));
      return wrap;
    }

    wrap.appendChild(buildInspectorHead(selection));
    wrap.appendChild(buildDiffPane(selection));
    return wrap;
  }

  function buildInspectorHead(sel: Selection): HTMLElement {
    const head = el('div', 'git-changes__insp-head');
    head.appendChild(el('div', 'git-changes__insp-path', sel.file.path));
    if (sel.file.origPath) {
      head.appendChild(el('div', 'git-changes__insp-rename', VOCAB.changes.renamedFrom(sel.file.origPath)));
    }
    return head;
  }

  function buildDiffPane(sel: Selection): HTMLElement {
    const wrap = el('div', 'git-diff-wrap');

    const toolbar = el('div', 'git-diff-toolbar');
    const label = el('span', 'git-diff-toolbar__label', 'Diff');
    toolbar.appendChild(label);
    if (diff && !diff.binary) {
      const toggle = el('div', 'git-diff-toggle');
      toggle.appendChild(
        button(VOCAB.changes.diffSideBySide, `git-btn git-btn--sm${diffMode === 'split' ? ' git-btn--active' : ''}`, () => {
          diffMode = 'split';
          repaint();
        })
      );
      toggle.appendChild(
        button(VOCAB.changes.diffUnified, `git-btn git-btn--sm${diffMode === 'unified' ? ' git-btn--active' : ''}`, () => {
          diffMode = 'unified';
          repaint();
        })
      );
      toolbar.appendChild(toggle);
    }
    wrap.appendChild(toolbar);

    if (sel.section === 'untracked') {
      wrap.appendChild(renderDiffEmpty(VOCAB.changes.untrackedNoDiff));
      return wrap;
    }
    if (diffLoading && !diff) {
      wrap.appendChild(el('div', 'git-empty-inline', VOCAB.changes.loadingDiff));
      return wrap;
    }
    if (diffError) {
      wrap.appendChild(buildRetryBanner(`${VOCAB.changes.diffFailed}: ${diffError}`, () => void loadDiff(sel)));
      return wrap;
    }
    if (!diff) {
      wrap.appendChild(renderDiffEmpty(VOCAB.changes.selectFileHint));
      return wrap;
    }
    if (diff.binary) {
      wrap.appendChild(renderDiffEmpty(VOCAB.changes.binaryFile));
      return wrap;
    }

    const hunks = parsePatch(diff.patch);
    if (hunks.length === 0) {
      wrap.appendChild(renderDiffEmpty(VOCAB.changes.noDiffContent));
    } else {
      wrap.appendChild(diffMode === 'split' ? renderDiffSideBySide(hunks) : renderDiffUnified(hunks));
    }
    if (diff.truncated) {
      wrap.appendChild(el('div', 'git-diff-truncated', VOCAB.changes.diffTruncated));
    }
    return wrap;
  }

  void load();
}
