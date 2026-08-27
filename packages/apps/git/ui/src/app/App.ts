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
import { renderChangesLists, renderChangesTree, renderHistory, renderPrs, renderWorktrees } from '../views';
import { mountBranchesView } from '../views/branches';
import { VOCAB } from '../vocabulary';
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
}

export class App {
  private root: HTMLElement;
  private state: AppState;
  /** Gotcha (memory `reference_pkg_subroute_deeplinks`): the shell pushes the
   *  LAST STORED activeFeature immediately on mount, which can beat the
   *  pathname-derived initial view. The first hostContext push loses to the
   *  pathname view unless it agrees with it; every push after that is a real
   *  click and applies normally. */
  private appliedInitialView = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.state = {
      view: deriveInitialView(),
      activeRepo: null,
      rollup: null,
      emptyReason: null,
      loading: true,
      ghProbe: null,
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
    if (feature === this.state.view) return;
    this.setState({ view: feature });
    persistView(feature);
    publishMenu(feature, this.state.rollup);
    void hostNavigate(pathForView(feature));
  }

  private setState(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.render();
  }

  async scan(): Promise<void> {
    const ctx = getHostContext();
    const project = ctx?.royaltiSuite?.activeProject;
    // The three input cases map 1:1 onto project.scan's args (rpc.ts):
    //   field absent  -> undefined -> no-project
    //   root is null  -> null      -> no-project-root
    //   root is a path-> string    -> scan
    const root = project === undefined ? undefined : project === null ? null : project.root;

    this.setState({ loading: true });
    try {
      const res = await rpc('project.scan', { root, fresh: false });
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
      this.setState({ loading: false, emptyReason: null, rollup, activeRepo });
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

    const title = document.createElement('h1');
    title.className = 'git-header__title';
    title.textContent = VOCAB.nav[this.state.view];
    header.appendChild(title);

    const entries = rollup.repos.map((r) => ({
      repo: r.repo,
      name: r.name,
      relPath: r.relPath,
      dirty: r.staged + r.unstaged + r.untracked,
    }));
    header.appendChild(
      renderRepoPicker(entries, this.state.activeRepo, (repo) => this.setState({ activeRepo: repo }))
    );

    return header;
  }

  private viewNode(rollup: ProjectRollup): HTMLElement {
    const activeRepo = rollup.repos.find((r) => r.repo === this.state.activeRepo) ?? rollup.repos[0]!;

    switch (this.state.view) {
      case 'changes': {
        const wrap = document.createElement('div');
        wrap.className = 'git-view git-view--changes';
        wrap.appendChild(renderChangesTree(rollup, activeRepo.repo, (repo) => this.setState({ activeRepo: repo })));
        const listsHost = document.createElement('div');
        listsHost.className = 'git-view__lists';
        listsHost.appendChild(this.loadingNode());
        wrap.appendChild(listsHost);
        rpc('changes.list', { repo: activeRepo.repo })
          .then((res) => {
            if (!res.ok || this.state.view !== 'changes' || this.state.activeRepo !== activeRepo.repo) return;
            listsHost.innerHTML = '';
            listsHost.appendChild(renderChangesLists(res.staged, res.unstaged, res.untracked));
          })
          .catch(() => {
            listsHost.innerHTML = '';
          });
        return wrap;
      }
      case 'history': {
        const wrap = document.createElement('div');
        wrap.className = 'git-view git-view--history';
        wrap.appendChild(this.loadingNode());
        rpc('history.log', { repo: activeRepo.repo, limit: 500 })
          .then((res) => {
            if (this.state.view !== 'history' || this.state.activeRepo !== activeRepo.repo) return;
            wrap.innerHTML = '';
            wrap.appendChild(renderHistory(res.ok ? res.commits : []));
          })
          .catch(() => {
            wrap.innerHTML = '';
          });
        return wrap;
      }
      case 'branches': {
        const wrap = document.createElement('div');
        wrap.className = 'git-view git-view--branches';
        // WP-09: the Branches view is stateful (form open, a pending G-12
        // confirm, an in-flight submit) and owns its own render loop rather
        // than going through App's setState — see views/branches/index.ts's
        // header comment. `onChanged` re-scans the project after any
        // successful mutation so the header / dirty counts / other views
        // pick up the new branch state.
        mountBranchesView(wrap, { repo: activeRepo.repo, rpc, onChanged: () => void this.scan() });
        return wrap;
      }
      case 'worktrees': {
        const wrap = document.createElement('div');
        wrap.className = 'git-view git-view--worktrees';
        wrap.appendChild(renderWorktrees(activeRepo.worktrees));
        return wrap;
      }
      case 'prs': {
        const wrap = document.createElement('div');
        wrap.className = 'git-view git-view--prs';
        wrap.appendChild(renderPrs(this.state.ghProbe));
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
