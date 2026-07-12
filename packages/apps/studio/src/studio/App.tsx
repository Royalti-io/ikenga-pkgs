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

import { isStandalone } from './bridge';
import { useLayoutStore } from './layout-store';
import { useProjectStore, selectIsProjectOpen, selectOpenProject } from './project-store';
import { useStoryboardStore } from './storyboard-store';
import { useRenderPoll } from './lib/use-render-poll';
import type { PaneIndex, ViewComponentRegistry } from './routes';
import { LayoutSwitcher } from './components/LayoutSwitcher';
import { Split } from './components/Split';
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
  const ratios = useLayoutStore((s) => s.ratios);
  const setRatio = useLayoutStore((s) => s.setRatio);
  const resetRatio = useLayoutStore((s) => s.resetRatio);

  if (layout === 'single') {
    return (
      <div className="flex min-h-0 flex-1 p-1.5">
        <Pane index={0} />
      </div>
    );
  }

  if (layout === 'vsplit') {
    return (
      <div className="min-h-0 flex-1 p-1.5">
        <Split
          axis="x"
          label="Resize left/right panes"
          ratio={ratios.vsplit[0]}
          onRatio={(v) => setRatio('vsplit', 0, v)}
          onReset={() => resetRatio('vsplit', 0)}
          first={<Pane index={0} />}
          second={<Pane index={1} />}
        />
      </div>
    );
  }

  if (layout === 'hsplit') {
    return (
      <div className="min-h-0 flex-1 p-1.5">
        <Split
          axis="y"
          label="Resize top/bottom panes"
          ratio={ratios.hsplit[0]}
          onRatio={(v) => setRatio('hsplit', 0, v)}
          onReset={() => resetRatio('hsplit', 0)}
          first={<Pane index={0} />}
          second={<Pane index={1} />}
        />
      </div>
    );
  }

  // tripane: two on top, one full-width below — matches the design glyph.
  // Outer split (axis y, divider index 1) sizes the top row vs pane 3; the
  // inner split (axis x, divider index 0) sizes pane 1 vs pane 2 within the row.
  return (
    <div className="min-h-0 flex-1 p-1.5">
      <Split
        axis="y"
        label="Resize top row and bottom pane"
        ratio={ratios.tripane[1]}
        onRatio={(v) => setRatio('tripane', 1, v)}
        onReset={() => resetRatio('tripane', 1)}
        first={
          <Split
            axis="x"
            label="Resize top-left and top-right panes"
            ratio={ratios.tripane[0]}
            onRatio={(v) => setRatio('tripane', 0, v)}
            onReset={() => resetRatio('tripane', 0)}
            first={<Pane index={0} />}
            second={<Pane index={1} />}
          />
        }
        second={<Pane index={2} />}
      />
    </div>
  );
}

export function App() {
  const isProjectOpen = useProjectStore(selectIsProjectOpen);
  const openProjectSummary = useProjectStore(selectOpenProject);
  // Sync window-parent probe (stable for the iframe's lifetime): shell vs
  // standalone. Gates the banner LayoutSwitcher (see the header comment).
  const standalone = isStandalone();
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

  // Render-status poll (adaptive): fast only while a render is in flight, idle
  // otherwise — kills the old unconditional 2.5s global chatter
  // (`poll-render-list-unbounded`). Still app-wide so the NowRenderingBeacon +
  // the Composition timeline both reflect live running→done regardless of which
  // view is mounted. No-op in mock/standalone.
  useRenderPoll();

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
        <div className="flex min-w-0 items-center gap-2">
          {/* pkg id lives in the tooltip / debug only — not user-facing chrome. */}
          <span
            className="font-display text-sm font-semibold tracking-tight"
            title="com.ikenga.studio"
          >
            Studio
          </span>
          {openProjectSummary?.name && (
            <>
              <span className="text-fg-faint">·</span>
              <span className="truncate font-mono text-[11px] text-fg-muted">
                {openProjectSummary.name}
              </span>
              {openProjectSummary.aspect_ratio && (
                <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-[10px] text-fg-faint">
                  {openProjectSummary.aspect_ratio}
                </span>
              )}
            </>
          )}
        </div>
        {/* In-shell, the M-A rail's kind:'seg' layout strip owns preset switching,
            so the banner sheds its four LayoutSwitcher radios (audit: view-switch
            redundancy). Standalone (pnpm dev, no shell side-menu) keeps the switcher
            so layout is still reachable — and the component file is retained for a
            future pop-out window banner that would render it again. */}
        {standalone && <LayoutSwitcher />}
      </header>
      <PaneRegion />
      {/* Layout-independent rendering beacon — floats over every view/layout
          (fixed positioning), visible whenever a render is in flight. */}
      <NowRenderingBeacon />
    </div>
  );
}
