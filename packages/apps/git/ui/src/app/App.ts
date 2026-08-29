// com.ikenga.git · UI shell root (WP-06)
//
// Boots the bridge, scans the active project, publishes the side-menu,
// renders whichever view is active, and re-scans on every D7 `repo.changed`
// push (poll/index.ts) or a menu click. All four G-05 no-root states render
// as named empty states (states/index.ts) — never a throw, never a git spawn
// on a null root.

import { connectBridge, getHostContext, hostNavigate, onHostContextChange, type BridgeConnection } from './bridge';
import type { GitHostContext } from './host-context';
import { deriveInitialView, pathForView, persistView, type ViewId } from './routes';
import { publishMenu } from '../menu';
import { watchProjectFreshness } from '../poll';
import { rpc, usingMock } from './transport';
import { renderEmptyState, renderRepoPicker, type EmptyStateReason } from '../states';
import { createResizer } from '../components/resizer';
import { renderChangesTree, renderPrs, renderWorktrees } from '../views';
import { mountBranchesView } from '../views/branches';
import { mountChangesView } from '../views/changes';
import { mountPrsView } from '../views/prs';
import { mountWorktreesView } from '../views/worktrees';
import { HistoryView } from '../views/history';
import { VOCAB, getVocab } from '../vocabulary';
import type { ProjectRollup } from './rpc';

const NO_ROOT_REASONS: readonly EmptyStateReason[] = [
  'no-project',
  'no-project-root',
  'not-a-repository',
  'unreadable',
];

function isEmptyStateReason(v: string): v is EmptyStateReason {
  return (NO_ROOT_REASONS as readonly string[]).includes(v);
}

interface AppState {
  view: ViewId;
  activeRepo: string | null;
  rollup: ProjectRollup | null;
  emptyReason: EmptyStateReason | null;
  loading: boolean;
  ghProbe: { present: boolean; authenticated: boolean } | null;
  mode: 'technical' | 'simplified';
}

export class App {
  private root: HTMLElement;
  private state: AppState;
  private appliedInitialView = false;
  private currentProjectId: string | null | undefined = undefined;
  private currentProjectRoot: string | null | undefined = undefined;
  private historyView: HistoryView | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.state = {
      view: deriveInitialView(),
      activeRepo: null,
      rollup: null,
      emptyReason: null,
      loading: true,
      ghProbe: null,
      mode: 'technical',
    };
  }

  async start(): Promise<void> {
    const connection: BridgeConnection = await connectBridge({ name: '@ikenga/pkg-git' });
    onHostContextChange((ctx) => this.onHostContext(ctx));
    if (connection.hostContext) this.onHostContext(connection.hostContext);

    rpc('system.probe', {})
      .then((res) => {
        if (res.ok) this.setState({ ghProbe: res.gh });
      })
      .catch(() => {
        // Non-fatal — the PRs view degrades to "gh missing" copy.
      });

    watchProjectFreshness(() => {
      void this.scan();
    });

    await this.scan();
  }

  /** Menu clicks arrive as `hostContext.royaltiSuite.activeFeature` changes —
   *  the shell handles the click itself (host.pkg.setMenu, menu/index.ts) and
   *  re-emits the new feature id; the pkg never fires its own view change. */
  private onHostContext(ctx: GitHostContext): void {
    const project = ctx.royaltiSuite?.activeProject;
    const projectId = project?.id ?? null;
    const projectRoot = project?.root ?? null;

    const projectChanged =
      this.currentProjectId !== undefined &&
      (projectId !== this.currentProjectId || projectRoot !== this.currentProjectRoot);

    this.currentProjectId = projectId;
    this.currentProjectRoot = projectRoot;

    if (projectChanged) {
      if (this.historyView) {
        this.historyView.dispose();
        this.historyView = null;
      }
      this.setState({ activeRepo: null, rollup: null });
      void this.scan(projectRoot);
    }

    const feature = ctx.royaltiSuite?.activeFeature;
    if (!feature || !isViewId(feature)) {
      this.appliedInitialView = true;
      return;
    }
    if (!this.appliedInitialView) {
      this.appliedInitialView = true;
      // First push: the shell pushes the LAST STORED activeFeature
      // immediately on mount, which can beat the pathname-derived initial
      // view (memory `reference_pkg_subroute_deeplinks`). Only honour it if
      // it agrees with the pathname view — the pathname wins otherwise, and
      // we sync the pane URL to match so the two stay consistent.
      if (feature === this.state.view) {
        this.render();
      } else {
        void hostNavigate(pathForView(this.state.view));
      }
      return;
    }
    if (feature === this.state.view && !projectChanged) return;
    this.setState({ view: feature });
    persistView(feature);
    publishMenu(feature, this.state.rollup);
    void hostNavigate(pathForView(feature));
  }

  private setState(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.render();
  }

  async scan(overrideRoot?: string | null): Promise<void> {
    const ctx = getHostContext();
    const project = ctx?.royaltiSuite?.activeProject;
    const root =
      overrideRoot !== undefined
        ? overrideRoot
        : (project === undefined ? undefined : project === null ? null : project.root);

    if (!this.state.rollup) {
      this.setState({ loading: true });
    }
    try {
      const res = await rpc('project.scan', { root, fresh: true });
      if (!res.ok) {
        const reason = isEmptyStateReason(res.reason) ? res.reason : 'unreadable';
        this.setState({ loading: false, emptyReason: reason, rollup: null });
        return;
      }
      const rollup = res.project;
      const activeRepo =
        this.state.activeRepo && rollup.repos.some((r) => r.repo === this.state.activeRepo)
          ? this.state.activeRepo
          : (rollup.repos[0]?.repo ?? null);

      const dirty = (r: { untracked: number; staged: number; unstaged: number }) =>
        r.untracked + r.staged + r.unstaged;

      const changed =
        this.state.loading ||
        this.state.emptyReason !== null ||
        this.state.activeRepo !== activeRepo ||
        !this.state.rollup ||
        this.state.rollup.repos.length !== rollup.repos.length ||
        this.state.rollup.repos.some(
          (r, i) =>
            r.repo !== rollup.repos[i]?.repo ||
            dirty(r) !== (rollup.repos[i] ? dirty(rollup.repos[i]!) : 0)
        );

      if (changed) {
        this.setState({ loading: false, emptyReason: null, rollup, activeRepo });
      }
      publishMenu(this.state.view, rollup);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[git] project.scan failed', err);
      this.setState({ loading: false, emptyReason: 'unreadable', rollup: null });
    }
  }

  private render(): void {
    this.root.innerHTML = '';
    const shell = document.createElement('div');
    shell.className = 'git-app';

    const banner = document.createElement('div');
    banner.className = 'git-dev-banner';
    if (usingMock) banner.textContent = 'mock sidecar';
    if (usingMock) shell.appendChild(banner);

    if (this.state.loading && !this.state.rollup && !this.state.emptyReason) {
      shell.appendChild(this.loadingNode());
      this.root.appendChild(shell);
      return;
    }

    if (this.state.emptyReason) {
      shell.appendChild(renderEmptyState(this.state.emptyReason));
      this.root.appendChild(shell);
      return;
    }

    const rollup = this.state.rollup;
    if (!rollup || rollup.repos.length === 0) {
      shell.appendChild(renderEmptyState('not-a-repository'));
      this.root.appendChild(shell);
      return;
    }

    shell.appendChild(this.headerNode(rollup));
    shell.appendChild(this.viewNode(rollup));
    this.root.appendChild(shell);
  }

  private loadingNode(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'git-loading';
    el.textContent = VOCAB.common.loading;
    return el;
  }

  private headerNode(rollup: ProjectRollup): HTMLElement {
    const header = document.createElement('div');
    header.className = 'git-header';

    const vocab = getVocab(this.state.mode);
    const title = document.createElement('h1');
    title.className = 'git-header__title';
    title.textContent = vocab.nav[this.state.view];
    header.appendChild(title);

    const rightControls = document.createElement('div');
    rightControls.style.display = 'flex';
    rightControls.style.alignItems = 'center';
    rightControls.style.gap = 'var(--space-2)';

    const modeBtn = document.createElement('button');
    modeBtn.type = 'button';
    modeBtn.className = 'git-btn git-btn--ghost git-btn--sm';
    modeBtn.textContent = this.state.mode === 'technical' ? 'Technical Mode' : 'Simplified Mode';
    modeBtn.title = 'Switch between Technical Git terms and Simplified Versioned History mode';
    modeBtn.addEventListener('click', () => {
      this.setState({ mode: this.state.mode === 'technical' ? 'simplified' : 'technical' });
    });
    rightControls.appendChild(modeBtn);

    const entries = rollup.repos.map((r) => ({
      repo: r.repo,
      name: r.name,
      relPath: r.relPath,
      dirty: r.staged + r.unstaged + r.untracked,
    }));
    rightControls.appendChild(
      renderRepoPicker(entries, this.state.activeRepo, (repo) => this.setState({ activeRepo: repo }))
    );

    header.appendChild(rightControls);

    return header;
  }

  private viewNode(rollup: ProjectRollup): HTMLElement {
    const activeRepo = rollup.repos.find((r) => r.repo === this.state.activeRepo) ?? rollup.repos[0]!;

    switch (this.state.view) {
      case 'changes': {
        const wrap = document.createElement('div');
        wrap.className = 'git-view git-view--changes';
        const tree = renderChangesTree(rollup, activeRepo.repo, (repo) => this.setState({ activeRepo: repo }));
        const resizer = createResizer(tree, 'repoTree', { minWidth: 160, maxWidth: 450, defaultWidth: 240 });
        wrap.appendChild(tree);
        wrap.appendChild(resizer);
        const changesHost = document.createElement('div');
        changesHost.className = 'git-view__changes-host';
        wrap.appendChild(changesHost);
        mountChangesView(changesHost, {
          repo: activeRepo.repo,
          repoName: activeRepo.name,
          branch: activeRepo.branch,
          rpc,
          onChanged: () => void this.scan(),
          onJumpToRepo: (repo) => this.setState({ activeRepo: repo }),
        });
        return wrap;
      }
      case 'history': {
        const wrap = document.createElement('div');
        wrap.className = 'git-view git-view--history';
        this.historyView ??= new HistoryView();
        this.historyView.setRepo(activeRepo.repo);
        this.historyView.mount(wrap);
        return wrap;
      }
      case 'branches': {
        const wrap = document.createElement('div');
        wrap.className = 'git-view git-view--branches';
        mountBranchesView(wrap, { repo: activeRepo.repo, rpc, onChanged: () => void this.scan() });
        return wrap;
      }
      case 'worktrees': {
        const wrap = document.createElement('div');
        wrap.className = 'git-view git-view--worktrees';
        mountWorktreesView(wrap, { repo: activeRepo.repo, rpc, onChanged: () => void this.scan() });
        return wrap;
      }
      case 'prs': {
        const wrap = document.createElement('div');
        wrap.className = 'git-view git-view--prs';
        mountPrsView(wrap, { repo: activeRepo.repo, rpc, onChanged: () => void this.scan() });
        return wrap;
      }
    }
  }
}

function isViewId(v: string): v is ViewId {
  return v === 'changes' || v === 'history' || v === 'branches' || v === 'worktrees' || v === 'prs';
}

export function mountApp(root: HTMLElement): App {
  const app = new App(root);
  void app.start();
  return app;
}
