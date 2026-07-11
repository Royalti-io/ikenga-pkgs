// com.ikenga.studio · app-level keyboard map + focus trap
//
// The global (App-shell) half of the a11y keyboard contract (contract §8
// commit-15, a11y-keyboard.html). The per-view bindings stay with their views
// — Composition owns Space (play/pause) + Left/Right (beat scrub) when a
// Composition pane is focused; the scrubber owns role="slider" ±1-frame arrows.
// This hook only handles the bindings that are the shell's responsibility and
// must work regardless of which view a pane shows:
//
//   1–5        switch the FOCUSED pane's view (Canvas/Cell/Composition/Script/
//              Archetype) — only when a pane-chrome element (not a text field)
//              holds focus. Digit→view comes from routes.VIEWS[id].key.
//   F6 / Ctrl+`  cycle focus to the next pane (Shift → previous), and move DOM
//              focus into that pane's chrome. Writes ui-only focusedPane, never
//              the shared-state model (a11y-keyboard.html §"Focus-trap").
//   Esc        release the focus trap → the active pane's chrome (the <section>).
//   Tab        trap focus WITHIN the active pane ONCE focus is inside it (the
//              V-split focus-trap): Tab / Shift+Tab wrap at the pane's focusable
//              boundaries. When focus is on the top app chrome (LayoutSwitcher)
//              rather than inside a pane, native Tab flows normally so that
//              chrome stays keyboard-reachable (it is NOT force-pulled into a
//              pane); the LayoutSwitcher is itself an arrow-key radiogroup.
//
// Arrow keys are deliberately NOT handled here: they are context-sensitive and
// belong to the focused view (Composition scrubs playheadMs; the scrubber steps
// frames), matching a11y-keyboard.html's "the active pane's view determines
// which binding fires".

import { useEffect } from 'react';

import { LAYOUTS, VIEWS, VIEW_IDS, type ViewId } from '../routes';
import { useLayoutStore } from '../layout-store';

const TEXT_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (TEXT_TAGS.has(el.tagName)) return true;
  return (el as HTMLElement).isContentEditable === true;
}

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusablesIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    // Skip hidden nodes (offsetParent is null for display:none / detached).
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

function paneEl(index: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-pane-index="${index}"]`);
}

// digit ('1'..'5') → ViewId, derived from the canonical VIEWS key map.
const DIGIT_TO_VIEW: Record<string, ViewId> = Object.fromEntries(
  VIEW_IDS.map((id) => [VIEWS[id].key, id]),
);

export function useStudioKeyboard() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;

      // ── 1–5 · view switcher on the focused pane ──────────────────────────
      if (
        !e.ctrlKey && !e.metaKey && !e.altKey &&
        DIGIT_TO_VIEW[e.key] &&
        !isTextEntry(active)
      ) {
        const { focusedPane, setPaneView } = useLayoutStore.getState();
        setPaneView(focusedPane, DIGIT_TO_VIEW[e.key]);
        e.preventDefault();
        return;
      }

      // ── F6 / Ctrl+` · cycle focus between panes ──────────────────────────
      if (e.key === 'F6' || (e.ctrlKey && e.key === '`')) {
        e.preventDefault();
        useLayoutStore.getState().cycleFocus(e.shiftKey ? -1 : 1);
        paneEl(useLayoutStore.getState().focusedPane)?.focus();
        return;
      }

      // ── Esc · release the focus trap back to the pane chrome ─────────────
      if (e.key === 'Escape') {
        const { focusedPane } = useLayoutStore.getState();
        const pane = paneEl(focusedPane);
        if (pane && active && active !== pane && pane.contains(active)) {
          pane.focus();
          e.preventDefault();
        }
        return;
      }

      // ── Tab · trap focus within the active pane ──────────────────────────
      if (e.key === 'Tab') {
        const { layout, focusedPane } = useLayoutStore.getState();
        // Only meaningful when there is chrome to escape to (>1 pane) — but the
        // trap is applied uniformly so a single pane also keeps focus local.
        void LAYOUTS[layout];
        const pane = paneEl(focusedPane);
        if (!pane) return;
        const items = focusablesIn(pane);
        const activeEl = active as HTMLElement | null;
        const inside = activeEl ? pane.contains(activeEl) : false;

        // Exempt the top app-chrome (LayoutSwitcher etc.) from the trap: when
        // focus is NOT inside the focused pane, let native Tab flow so the
        // chrome above the panes is reachable by keyboard. The trap only wraps
        // once focus is already inside a pane (below).
        if (!inside) return;

        if (items.length === 0) {
          pane.focus();
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];

        if (!e.shiftKey && activeEl === last) {
          first.focus();
          e.preventDefault();
        } else if (e.shiftKey && (activeEl === first || activeEl === pane)) {
          last.focus();
          e.preventDefault();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
