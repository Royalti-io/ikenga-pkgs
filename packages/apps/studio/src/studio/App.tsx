// com.ikenga.studio · App
//
// The Pattern C harness: a top bar with the LayoutSwitcher, and a pane region
// that renders 1–3 panes per the active layout preset. Each pane has its own
// header (ViewSwitcher) and body (the registered view component, or a
// PanePlaceholder until that view's commit lands).
//
// This commit (5) wires layout + view routing + focus only. The concrete
// views (Canvas/Cell/Composition/Script/Archetype) register into
// VIEW_COMPONENTS as commits 6–11 land; the launcher pre-empt (no open
// project → full-bleed Launcher) lands in commit 11. Cross-linking (commit
// 12) reads the shared store the views already subscribe to — App.tsx itself
// stays cross-link-agnostic.

import { useLayoutStore } from './layout-store';
import type { PaneIndex, ViewComponentRegistry } from './routes';
import { LayoutSwitcher } from './components/LayoutSwitcher';
import { ViewSwitcher } from './components/ViewSwitcher';
import { PanePlaceholder } from './components/PanePlaceholder';
import { CanvasView } from './views/Canvas';
import { CellView } from './views/Cell';

// View component registry. Each view commit (6–11) adds its entry here.
// Until a view registers, App.tsx falls through to PanePlaceholder for it.
const VIEW_COMPONENTS: ViewComponentRegistry = {
  canvas: CanvasView,
  cell:   CellView,
};

function Pane({ index }: { index: PaneIndex }) {
  const view = useLayoutStore((s) => s.paneViews[index]);
  const focused = useLayoutStore((s) => s.focusedPane === index);
  const setFocusedPane = useLayoutStore((s) => s.setFocusedPane);

  const ViewComponent = VIEW_COMPONENTS[view];

  return (
    <section
      className={
        'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border bg-surface '
        + (focused ? 'border-[var(--border)]' : 'border-soft')
      }
      // Click anywhere in the pane focuses it (drives the 1–5 view shortcut
      // + the focus trap in commit 15).
      onMouseDown={() => setFocusedPane(index)}
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
    </div>
  );
}
