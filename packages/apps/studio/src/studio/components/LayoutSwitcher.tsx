// com.ikenga.studio · LayoutSwitcher
//
// Top-right cluster of four preset toggles (Single / V-split / H-split /
// 3-pane), lifted from designs/pattern-c-split.html. Each toggle shows a tiny
// glyph of the pane arrangement. The active preset is highlighted; clicking
// one calls layoutStore.setLayout. Icons are inline SVG so the harness needs
// no icon dependency.

import { useRef } from 'react';

import { LAYOUT_ORDER, LAYOUTS, type LayoutId } from '../routes';
import { useLayoutStore, selectLayout } from '../layout-store';

function LayoutGlyph({ id }: { id: LayoutId }) {
  // 20×12 viewbox; thin outlined panes matching the design's mini-diagrams.
  const stroke = 'currentColor';
  switch (id) {
    case 'single':
      return (
        <svg width="20" height="12" viewBox="0 0 20 12" fill="none" aria-hidden>
          <rect x="0.5" y="0.5" width="19" height="11" rx="1.5" stroke={stroke} />
        </svg>
      );
    case 'vsplit':
      return (
        <svg width="20" height="12" viewBox="0 0 20 12" fill="none" aria-hidden>
          <rect x="0.5" y="0.5" width="9" height="11" rx="1.5" stroke={stroke} />
          <rect x="10.5" y="0.5" width="9" height="11" rx="1.5" stroke={stroke} />
        </svg>
      );
    case 'hsplit':
      return (
        <svg width="20" height="12" viewBox="0 0 20 12" fill="none" aria-hidden>
          <rect x="0.5" y="0.5" width="19" height="5" rx="1.5" stroke={stroke} />
          <rect x="0.5" y="6.5" width="19" height="5" rx="1.5" stroke={stroke} />
        </svg>
      );
    case 'tripane':
      return (
        <svg width="20" height="12" viewBox="0 0 20 12" fill="none" aria-hidden>
          <rect x="0.5" y="0.5" width="9" height="5" rx="1.5" stroke={stroke} />
          <rect x="10.5" y="0.5" width="9" height="5" rx="1.5" stroke={stroke} />
          <rect x="0.5" y="6.5" width="19" height="5" rx="1.5" stroke={stroke} />
        </svg>
      );
  }
}

export function LayoutSwitcher() {
  const layout = useLayoutStore(selectLayout);
  const setLayout = useLayoutStore((s) => s.setLayout);
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Roving-tabindex radiogroup: only the checked radio is in the tab order, and
  // Arrow / Home / End move selection *and* focus (WAI-ARIA radiogroup pattern).
  function onKeyDown(e: React.KeyboardEvent) {
    const len = LAYOUT_ORDER.length;
    const idx = LAYOUT_ORDER.indexOf(layout);
    let next = idx;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown': next = (idx + 1) % len; break;
      case 'ArrowLeft':
      case 'ArrowUp':   next = (idx - 1 + len) % len; break;
      case 'Home':      next = 0; break;
      case 'End':       next = len - 1; break;
      default: return;
    }
    e.preventDefault();
    setLayout(LAYOUT_ORDER[next]);
    btnRefs.current[next]?.focus();
  }

  return (
    <div
      className="flex items-center gap-0.5 rounded-md border border-soft bg-sunken p-0.5"
      role="radiogroup"
      aria-label="Layout preset"
      onKeyDown={onKeyDown}
    >
      {LAYOUT_ORDER.map((id, i) => {
        const active = id === layout;
        return (
          <button
            key={id}
            ref={(el) => { btnRefs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={LAYOUTS[id].label}
            title={LAYOUTS[id].label}
            tabIndex={active ? 0 : -1}
            onClick={() => setLayout(id)}
            className={
              'flex h-6 w-7 items-center justify-center rounded transition-colors '
              + 'focus-visible:outline-none focus-visible:ring-2 '
              + 'focus-visible:ring-[color-mix(in_oklab,var(--info)_55%,transparent)] '
              + (active
                ? 'bg-raised text-fg'
                : 'text-fg-faint hover:text-fg-muted hover:bg-raised/60')
            }
          >
            <LayoutGlyph id={id} />
          </button>
        );
      })}
    </div>
  );
}
