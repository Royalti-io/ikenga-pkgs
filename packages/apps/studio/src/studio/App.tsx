// com.ikenga.studio · App
//
// The Pattern C harness: a top bar with the LayoutSwitcher, and a pane region
// that renders 1–3 panes per the active layout preset. Each pane has its own
// header (ViewSwitcher) and body (the registered view component, or a
// PanePlaceholder until that view's commit lands).
//
// This commit (5) wired layout + view routing + focus only; the launcher
// pre-empt (no open project → full-bleed Launcher, G25) lands in commit 11
// as the `!isOpen` early-return below. Cross-linking (commit 12) reads the
// shared store the views already subscribe to — App.tsx itself stays
// cross-link-agnostic.

import { useEffect } from 'react';

import { useLayoutStore } from './layout-store';
import { useProjectStore, selectIsProjectOpen, selectOpenProject } from './project-store';
import { useStoryboardStore, selectStoryboardSource } from './storyboard-store';
import type { PaneIndex, ViewComponentRegistry } from './routes';
import { LayoutSwitcher } from './components/LayoutSwitcher';
import { ViewSwitcher } from './components/ViewSwitcher';
import { PanePlaceholder } from './components/PanePlaceholder';
import { CanvasView } from './views/Canvas';
import { CellView } from './views/Cell';
import { CompositionView } from './views/Composition';
import { ScriptView } from './views/Script';
import { ArchetypeBuilderView } from './views/ArchetypeBuilder';
import { LauncherView } from './views/Launcher';
import { NowRenderingBeacon } from './components/NowRenderingBeacon';
import { useStudioKeyboard } from './lib/use-studio-keyboard';
import { initStudioMenu } from './menu';

// View component registry. Each view commit (6–11) adds its entry here.
// Until a view registers, App.tsx falls through to PanePlaceholder for it.
const VIEW_COMPONENTS: ViewComponentRegistry = {
  canvas:      CanvasView,
  cell:        CellView,
  composition: CompositionView,
  script:      ScriptView,
  archetype:   ArchetypeBuilderView,
};

function Pane({ index }: { index: PaneIndex }) {
  const view = useLayoutStore((s) => s.paneViews[index]);
  const focused = useLayoutStore((s) => s.focusedPane === index);
  const setFocusedPane = useLayoutStore((s) => s.setFocusedPane);

  const ViewComponent = VIEW_COMPONENTS[view];

  return (
    <section
      // `data-pane-index` + a programmatic-only tab stop (-1) let the commit-15
      // keyboard map target this pane's chrome (Esc / F6 focus moves) and scope
      // the Tab focus-trap to it. focused pane gets the info/sky ring.
      data-pane-index={index}
      tabIndex={-1}
      className={
        'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border bg-surface outline-none '
        + (focused
          ? 'border-[var(--border)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--info)_45%,transparent)]'
          : 'border-soft')
      }
      // Click OR keyboard focus entering the pane makes it the active pane
      // (drives the 1–5 view shortcut + the focus trap).
      onMouseDown={() => setFocusedPane(index)}
      onFocusCapture={() => setFocusedPane(index)}
      aria-current={focused ? 'true' : undefined}
    >
      <header className="flex items-center justify-between gap-2 border-b border-soft bg-sunken px-2 py-1">
        <ViewSwitcher pane={index} />
        <span className="font-mono text-[9px] uppercase tracking-wider text-fg-faint">
          pane {index + 1}
        </span>
      </header>
      <div className="min-h-0 flex-1">
        {ViewComponent ? <ViewComponent /> : <PanePlaceholder view={view} />}
      </div>
    </section>
  );
}

function PaneRegion() {
  const layout = useLayoutStore((s) => s.layout);

  if (layout === 'single') {
    return (
      <div className="flex min-h-0 flex-1 p-1.5">
        <Pane index={0} />
      </div>
    );
  }

  if (layout === 'vsplit') {
    return (
      <div className="flex min-h-0 flex-1 gap-1.5 p-1.5">
        <Pane index={0} />
        <Pane index={1} />
      </div>
    );
  }

  if (layout === 'hsplit') {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-1.5">
        <Pane index={0} />
        <Pane index={1} />
      </div>
    );
  }

  // tripane: two on top, one full-width below — matches the design glyph.
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-1.5">
      <div className="flex min-h-0 flex-1 gap-1.5">
        <Pane index={0} />
        <Pane index={1} />
      </div>
      <Pane index={2} />
    </div>
  );
}

export function App() {
  const isProjectOpen = useProjectStore(selectIsProjectOpen);
  const openProjectSummary = useProjectStore(selectOpenProject);
  const bindPersistence = useLayoutStore((s) => s.bindPersistence);
  const unbindPersistence = useLayoutStore((s) => s.unbindPersistence);

  // App-level keyboard map + V-split focus trap (commit 15). Registered
  // unconditionally; its handlers no-op until a pane region exists.
  useStudioKeyboard();

  // Sidebar menu: publish on mount, republish on project open/close, route
  // menu clicks (activeFeature) onto the focused pane.
  useEffect(() => initStudioMenu(), []);

  // Per-folder layout persistence: rehydrate + arm the layout store when a
  // project opens; stop persisting when it closes. Keyed by project id so each
  // folder restores its own pane arrangement across remounts (layout-store.ts).
  useEffect(() => {
    const projectId = openProjectSummary?.project_id;
    if (projectId) bindPersistence(projectId);
    else unbindPersistence();
  }, [openProjectSummary?.project_id, bindPersistence, unbindPersistence]);

  // Storyboard hydration: read the open project's cells from disk (via
  // storyboard.read) so Canvas/Cell render REAL cells. In mock/standalone mode
  // this loads the mock's storyboard and the views fall back to their fixture.
  const hydrateStoryboard = useStoryboardStore((s) => s.hydrate);
  const clearStoryboard = useStoryboardStore((s) => s.clear);
  useEffect(() => {
    const projectId = openProjectSummary?.project_id;
    if (projectId) void hydrateStoryboard(projectId);
    else clearStoryboard();
  }, [openProjectSummary?.project_id, hydrateStoryboard, clearStoryboard]);

  // Render-status poll: the shell can't relay pkg:// render/progress events to
  // the iframe (Round-13 Finding), so poll render.list while a REAL project is
  // open and fold it into the storyboard-store. Runs app-wide (not per-pane) so
  // the now-rendering beacon + the Composition timeline both reflect live
  // running→done regardless of which view is mounted. No-op in mock/standalone.
  const storyboardSource = useStoryboardStore(selectStoryboardSource);
  const refreshRenders = useStoryboardStore((s) => s.refreshRenders);
  useEffect(() => {
    const projectId = openProjectSummary?.project_id;
    if (!projectId || storyboardSource !== 'real') return;
    void refreshRenders();
    const id = window.setInterval(() => { void refreshRenders(); }, 2500);
    return () => window.clearInterval(id);
  }, [openProjectSummary?.project_id, storyboardSource, refreshRenders]);

  // The launcher pre-empts the pane layout entirely — it isn't a sub-view
  // and doesn't share the layout/view-switcher chrome (launcher.md §"Chrome
  // & Navigation": "There is no pane chrome or view-switcher"). It unmounts
  // the moment a project opens.
  if (!isProjectOpen) {
    return <LauncherView />;
  }

  return (
    <div className="flex h-full flex-col bg-base text-fg">
      <header className="flex items-center justify-between border-b border-soft bg-sunken px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="font-display text-sm font-semibold tracking-tight">Studio</span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-fg-faint">
            com.ikenga.studio
          </span>
        </div>
        <LayoutSwitcher />
      </header>
      <PaneRegion />
      {/* Layout-independent rendering beacon — floats over every view/layout
          (fixed positioning), visible whenever a render is in flight. */}
      <NowRenderingBeacon />
    </div>
  );
}
