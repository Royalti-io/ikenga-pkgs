// com.ikenga.studio · ViewSwitcher
//
// Per-pane view picker that lives in each pane's header. Renders one chip per
// sub-view (Canvas / Cell / Composition / Script / Archetype); the active
// view is highlighted. Clicking a chip swaps that pane's view via
// layoutStore.setPaneView — it never touches shared state, so the cursor /
// playhead survive a view swap. The 1–5 keyboard shortcut (a11y-keyboard.html)
// is wired in commit 15 against the focused pane; the chip's `key` digit is
// shown as a hint here.

import { VIEW_ORDER, VIEWS, type ViewId } from '../routes';
import { useLayoutStore } from '../layout-store';
import type { PaneIndex } from '../routes';

export function ViewSwitcher({ pane }: { pane: PaneIndex }) {
  const current = useLayoutStore((s) => s.paneViews[pane]);
  const setPaneView = useLayoutStore((s) => s.setPaneView);
  const setFocusedPane = useLayoutStore((s) => s.setFocusedPane);

  return (
    <div
      className="flex items-center gap-0.5"
      role="tablist"
      aria-label="Pane view"
    >
      {VIEW_ORDER.map((id: ViewId) => {
        const meta = VIEWS[id];
        const active = id === current;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            title={`${meta.label}  ·  ${meta.key}`}
            onClick={() => {
              setFocusedPane(pane);
              setPaneView(pane, id);
            }}
            className={
              'rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors '
              + (active
                ? 'bg-raised text-fg'
                : 'text-fg-faint hover:text-fg-muted hover:bg-raised/50')
            }
          >
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}
