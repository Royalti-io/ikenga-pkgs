/**
 * com.ikenga.git · History view (WP-08).
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │  head    attribution filter · loaded count                                │
 * │ ┌──────────────────────────────┬────────────────────────────────────────┐ │
 * │ │ rail │ rows (fixed height)   │  commit detail (D-01 inspector)        │ │
 * │ └──────────────────────────────┴────────────────────────────────────────┘ │
 * │  foot    load more · beginning of history                                 │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ── Paging ──────────────────────────────────────────────────────────────────
 * 500 then 200, GitLens's shape (02-research-external.md [13]) and the size
 * `history.log`'s args were frozen around (rpc.ts §HistoryLogArgs). `skip`, not
 * an opaque cursor: the DAG under a ref is stable for the life of a page view,
 * and a ref that moved means we re-fetch from 0 anyway — which is exactly what
 * `refresh()` does on a `repo.changed` push.
 *
 * ── Why the whole layout is recomputed on append ────────────────────────────
 * A second page RESOLVES edges that dangled off the bottom of the first, so an
 * incremental layout would have to go back and patch them. At 500 + 200 rows
 * the recompute is microseconds — measured in `tools/history-cli.ts` against
 * this workspace's own 646-commit root repo.
 *
 * ── Why filtering dims instead of removing ──────────────────────────────────
 * The attribution filter can't drop rows: the rail is a DAG laid out over row
 * indices, so removing rows would either break every edge or force a second,
 * different graph. Dimming keeps one true graph and still answers "which of
 * these were co-authored".
 */

import { onRepoChanged } from '../../app/bridge';
import type { CommitSummary } from '../../app/rpc';
import { rpc } from '../../app/transport';
import { VOCAB } from '../../vocabulary';
import { renderCommitDetail } from './commit-detail';
import { computeGraphLayout, type GraphLayout } from './graph-layout';
import { railWidth, renderRail, ROW_HEIGHT } from './graph-rail';
import './history.css';

/** GitLens's paging shape (02-research-external.md [13]). */
export const FIRST_PAGE_SIZE = 500;
export const NEXT_PAGE_SIZE = 200;
/** `HistoryLogArgs.limit` is `.max(2000)` in the frozen contract (rpc.ts
 *  §HistoryLogArgs). A refresh that asked for more would be rejected by the
 *  real sidecar's schema — and the mock, which doesn't validate, would never
 *  have shown it. Past 2000 loaded rows a refresh re-reads the first 2000 and
 *  hands the rest back to "Load more"; `nextSkip` comes from the response, so
 *  the list stays internally consistent either way. */
const MAX_LOG_LIMIT = 2000;

/** Auto-load the next page once the viewport is within this many px of the end. */
const AUTOLOAD_THRESHOLD_PX = 600;

type AttributionFilter = 'all' | 'co-authored' | 'solo';

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function relTime(epochSeconds: number): string {
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - epochSeconds);
  if (diffSec < 60) return `${String(diffSec)}s`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${String(min)}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${String(hr)}h`;
  const day = Math.floor(hr / 24);
  if (day < 365) return `${String(day)}d`;
  return `${String(Math.floor(day / 365))}y`;
}

function matchesFilter(commit: CommitSummary, filter: AttributionFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'co-authored') return commit.coAuthors.length > 0;
  return commit.coAuthors.length === 0;
}

/** `HEAD -> main` reads better as `main` once the HEAD marker is its own chip. */
function refChips(refs: readonly string[]): HTMLElement[] {
  return refs.map((ref) => {
    const isHead = ref.startsWith('HEAD ->');
    const isTag = ref.startsWith('tag:');
    const label = isHead ? ref.slice('HEAD ->'.length).trim() : isTag ? ref.slice('tag:'.length).trim() : ref;
    const chip = el(
      'span',
      `git-chip${isHead ? ' git-chip--head' : ''}${isTag ? ' git-chip--tag' : ''}`,
      label
    );
    chip.title = ref;
    return chip;
  });
}

export class HistoryView {
  readonly element: HTMLElement;

  private repo: string | null = null;
  private commits: CommitSummary[] = [];
  private layout: GraphLayout = computeGraphLayout([]);
  private nextSkip: number | null = 0;
  private loading = false;
  private error: string | null = null;
  private selectedSha: string | null = null;
  private filter: AttributionFilter = 'all';
  private scrollTop = 0;
  /** Bumped on every load; a stale in-flight response checks it and bails. */
  private generation = 0;
  private readonly unsubscribeRepoChanged: () => void;

  private readonly headNode: HTMLElement;
  private readonly scrollNode: HTMLElement;
  private readonly canvasNode: HTMLElement;
  private readonly rowsNode: HTMLElement;
  private readonly detailNode: HTMLElement;
  private readonly footNode: HTMLElement;
  private railNode: SVGSVGElement | null = null;
  private readonly rowBySha = new Map<string, HTMLElement>();

  constructor() {
    this.element = el('div', 'git-hist');

    this.headNode = el('div', 'git-hist__head');
    this.element.appendChild(this.headNode);

    const body = el('div', 'git-hist__body');
    this.scrollNode = el('div', 'git-hist__scroll');
    this.canvasNode = el('div', 'git-hist__canvas');
    this.rowsNode = el('ul', 'git-hist__rows');
    this.rowsNode.setAttribute('role', 'listbox');
    this.rowsNode.setAttribute('aria-label', VOCAB.history.title);
    this.canvasNode.appendChild(this.rowsNode);
    this.scrollNode.appendChild(this.canvasNode);
    body.appendChild(this.scrollNode);

    this.detailNode = el('aside', 'git-hist__detail');
    body.appendChild(this.detailNode);
    this.element.appendChild(body);

    this.footNode = el('div', 'git-hist__foot');
    this.element.appendChild(this.footNode);

    this.scrollNode.addEventListener('scroll', () => {
      this.scrollTop = this.scrollNode.scrollTop;
      this.maybeAutoLoad();
    });

    // D7 push: a background agent committing in this repo should move the list
    // without anyone clicking anything.
    this.unsubscribeRepoChanged = onRepoChanged((params) => {
      const repo = (params as { repo?: unknown } | undefined)?.repo;
      if (typeof repo === 'string' && this.repo !== null && repo !== this.repo) return;
      void this.refresh();
    });

    this.renderHead();
    this.renderDetail();
    this.renderFoot();
  }

  /** Append into `parent` and restore the scroll position it had last time.
   *  The App re-renders its whole subtree on every state change, so without
   *  this a `repo.changed` push would jump the reader back to HEAD. */
  mount(parent: HTMLElement): void {
    parent.appendChild(this.element);
    requestAnimationFrame(() => {
      this.scrollNode.scrollTop = this.scrollTop;
    });
  }

  dispose(): void {
    this.unsubscribeRepoChanged();
  }

  /** Point the view at a repo. A no-op when it is already the active one. */
  setRepo(repo: string): void {
    if (this.repo === repo) return;
    this.repo = repo;
    // Invalidate anything in flight for the PREVIOUS repo — without this, a
    // `history.log` response for repo A that lands after the switch would be
    // appended to repo B's list, and the graph would be a splice of two DAGs.
    this.generation += 1;
    this.loading = false;
    this.commits = [];
    this.layout = computeGraphLayout([]);
    this.nextSkip = 0;
    this.selectedSha = null;
    this.error = null;
    this.scrollTop = 0;
    this.renderHead();
    this.renderRows();
    this.renderDetail();
    void this.loadNextPage();
  }

  /** Re-read everything currently loaded, in one call, from the top. */
  async refresh(): Promise<void> {
    if (this.repo === null) return;
    const want = Math.min(MAX_LOG_LIMIT, Math.max(FIRST_PAGE_SIZE, this.commits.length));
    this.generation += 1;
    const generation = this.generation;
    this.loading = true;
    this.renderFoot();

    const res = await rpc('history.log', { repo: this.repo, limit: want, skip: 0 });
    if (generation !== this.generation) return;
    this.loading = false;
    if (!res.ok) {
      this.error = res.message;
      this.renderHead();
      this.renderFoot();
      return;
    }
    this.error = null;
    this.commits = res.commits;
    this.nextSkip = res.nextSkip;
    this.relayout();
    this.renderHead();
    this.renderRows();
    this.renderFoot();
  }

  async loadNextPage(): Promise<void> {
    if (this.repo === null || this.loading || this.nextSkip === null) return;
    const skip = this.nextSkip;
    const limit = skip === 0 ? FIRST_PAGE_SIZE : NEXT_PAGE_SIZE;
    this.loading = true;
    this.renderFoot();
    const generation = this.generation;

    let res;
    try {
      res = await rpc('history.log', { repo: this.repo, limit, skip });
    } catch (err) {
      if (generation !== this.generation) return;
      this.loading = false;
      this.error = err instanceof Error ? err.message : String(err);
      this.renderHead();
      this.renderFoot();
      return;
    }
    if (generation !== this.generation) return;

    this.loading = false;
    if (!res.ok) {
      this.error = res.message;
      this.renderHead();
      this.renderFoot();
      return;
    }
    this.error = null;
    this.commits = skip === 0 ? res.commits : [...this.commits, ...res.commits];
    this.nextSkip = res.nextSkip;
    this.relayout();
    this.renderHead();
    this.renderRows();
    this.renderFoot();
  }

  private relayout(): void {
    this.layout = computeGraphLayout(this.commits);
  }

  private maybeAutoLoad(): void {
    if (this.nextSkip === null || this.loading) return;
    const remaining = this.scrollNode.scrollHeight - this.scrollNode.scrollTop - this.scrollNode.clientHeight;
    if (remaining < AUTOLOAD_THRESHOLD_PX) void this.loadNextPage();
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private renderHead(): void {
    this.headNode.innerHTML = '';

    const filters = el('div', 'git-hist__filters');
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', VOCAB.history.filterLabel);
    filters.appendChild(el('span', 'git-hist__filters-label', VOCAB.history.filterLabel));
    const options: Array<[AttributionFilter, string]> = [
      ['all', VOCAB.history.filterAll],
      ['co-authored', VOCAB.history.filterCoAuthored],
      ['solo', VOCAB.history.filterSolo],
    ];
    for (const [id, label] of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `git-hist__filter${this.filter === id ? ' is-on' : ''}`;
      button.textContent = label;
      button.setAttribute('aria-pressed', String(this.filter === id));
      const count = this.commits.filter((c) => matchesFilter(c, id)).length;
      if (this.commits.length > 0) {
        button.appendChild(el('span', 'git-hist__filter-count', String(count)));
      }
      button.addEventListener('click', () => {
        this.filter = id;
        this.renderHead();
        this.applyFilterClasses();
      });
      filters.appendChild(button);
    }
    this.headNode.appendChild(filters);

    const status = el('div', 'git-hist__status');
    if (this.error) {
      status.appendChild(el('span', 'git-hist__error', this.error));
    } else {
      status.appendChild(el('span', 'git-hist__count', VOCAB.history.loadedCount(this.commits.length)));
      if (this.layout.clamped) {
        status.appendChild(el('span', 'git-hist__warn', VOCAB.history.graphClamped));
      }
    }
    this.headNode.appendChild(status);
  }

  private renderRows(): void {
    this.rowsNode.innerHTML = '';
    this.rowBySha.clear();
    if (this.railNode) {
      this.railNode.remove();
      this.railNode = null;
    }

    if (this.commits.length === 0) {
      this.canvasNode.style.paddingLeft = '0px';
      if (!this.loading) this.rowsNode.appendChild(el('li', 'git-hist__empty', VOCAB.history.empty));
      return;
    }

    const gutter = railWidth(this.layout);
    this.canvasNode.style.paddingLeft = `${String(gutter)}px`;
    this.railNode = renderRail(this.layout, this.selectedSha);
    this.canvasNode.insertBefore(this.railNode, this.rowsNode);

    for (const commit of this.commits) {
      this.rowsNode.appendChild(this.renderRow(commit));
    }
    this.applyFilterClasses();
  }

  private renderRow(commit: CommitSummary): HTMLElement {
    const item = el('li', 'git-hist-row');
    item.style.height = `${String(ROW_HEIGHT)}px`;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(commit.sha === this.selectedSha));
    if (commit.sha === this.selectedSha) item.classList.add('is-selected');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'git-hist-row__hit';
    button.addEventListener('click', () => this.select(commit.sha));

    const sha = el('span', 'git-hist-row__sha', commit.shortSha);
    sha.title = commit.sha;
    button.appendChild(sha);

    if (commit.refs.length > 0) {
      const refs = el('span', 'git-hist-row__refs');
      for (const chip of refChips(commit.refs)) refs.appendChild(chip);
      button.appendChild(refs);
    }

    const subject = el('span', 'git-hist-row__subject', commit.subject);
    subject.title = commit.subject;
    button.appendChild(subject);

    // Attribution badge. Present → named. Absent → nothing here, because an
    // absent trailer is not a claim (02-research-external.md [27][28]); the
    // detail pane is where absence gets stated in words.
    if (commit.coAuthors.length > 0) {
      const names = commit.coAuthors.map((a) => a.name).join(', ');
      const badge = el('span', 'git-badge git-badge--co', VOCAB.history.coAuthored);
      badge.title = VOCAB.history.coAuthoredWith(names);
      button.appendChild(badge);
    }

    button.appendChild(el('span', 'git-hist-row__author', commit.authorName));
    const when = el('span', 'git-hist-row__when', relTime(commit.committedAt));
    when.title = new Date(commit.committedAt * 1000).toLocaleString();
    button.appendChild(when);

    item.appendChild(button);
    this.rowBySha.set(commit.sha, item);
    return item;
  }

  private applyFilterClasses(): void {
    for (const commit of this.commits) {
      const row = this.rowBySha.get(commit.sha);
      if (!row) continue;
      row.classList.toggle('is-dimmed', !matchesFilter(commit, this.filter));
    }
  }

  private select(sha: string): void {
    if (this.selectedSha === sha) return;
    const previous = this.selectedSha === null ? null : this.rowBySha.get(this.selectedSha);
    if (previous) {
      previous.classList.remove('is-selected');
      previous.setAttribute('aria-selected', 'false');
    }
    this.selectedSha = sha;
    const next = this.rowBySha.get(sha);
    if (next) {
      next.classList.add('is-selected');
      next.setAttribute('aria-selected', 'true');
      next.scrollIntoView({ block: 'nearest' });
    }
    // Cheapest way to move the highlighted dot: redraw the rail, one element.
    if (this.railNode) {
      const fresh = renderRail(this.layout, this.selectedSha);
      this.railNode.replaceWith(fresh);
      this.railNode = fresh;
    }
    void this.loadDetail(sha);
  }

  private async loadDetail(sha: string): Promise<void> {
    if (this.repo === null) return;
    this.detailNode.innerHTML = '';
    this.detailNode.appendChild(el('div', 'git-hist__detail-loading', VOCAB.common.loading));

    let res;
    try {
      res = await rpc('history.commit', { repo: this.repo, sha, withSignature: true });
    } catch (err) {
      if (this.selectedSha !== sha) return;
      this.renderDetailError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (this.selectedSha !== sha) return;
    if (!res.ok) {
      this.renderDetailError(res.message);
      return;
    }
    this.detailNode.innerHTML = '';
    this.detailNode.appendChild(
      renderCommitDetail(res.commit, {
        isLoaded: (candidate) => this.rowBySha.has(candidate),
        onSelectSha: (candidate) => this.select(candidate),
      })
    );
  }

  private renderDetailError(message: string): void {
    this.detailNode.innerHTML = '';
    const wrap = el('div', 'git-hist__detail-empty');
    wrap.appendChild(el('div', 'git-hist__detail-empty-title', VOCAB.history.detailFailed));
    wrap.appendChild(el('div', 'git-hist__detail-empty-hint', message));
    this.detailNode.appendChild(wrap);
  }

  private renderDetail(): void {
    this.detailNode.innerHTML = '';
    const wrap = el('div', 'git-hist__detail-empty');
    wrap.appendChild(el('div', 'git-hist__detail-empty-hint', VOCAB.history.selectHint));
    this.detailNode.appendChild(wrap);
  }

  private renderFoot(): void {
    this.footNode.innerHTML = '';
    if (this.loading) {
      this.footNode.appendChild(
        el('span', 'git-hist__foot-note', this.commits.length === 0 ? VOCAB.common.loading : VOCAB.history.loadingMore)
      );
      return;
    }
    if (this.nextSkip === null) {
      if (this.commits.length > 0) {
        this.footNode.appendChild(el('span', 'git-hist__foot-note', VOCAB.history.endOfHistory));
      }
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'git-hist__more';
    button.textContent = VOCAB.history.loadMore(NEXT_PAGE_SIZE);
    button.addEventListener('click', () => void this.loadNextPage());
    this.footNode.appendChild(button);
  }
}
