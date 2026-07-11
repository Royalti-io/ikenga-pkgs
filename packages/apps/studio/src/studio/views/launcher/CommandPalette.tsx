// com.ikenga.studio · Launcher — ⌘K command palette (graft from concept L-C)
//
// A light, keyboard-first overlay that lists the launcher's primary actions,
// filterable by typing, sharpening the R / O / N shortcuts. Accessibility
// (audit: launcher-trust-modal-no-focus-trap-or-escape + launcher-nontoken-
// black-overlay): token scrim (--overlay), focus trap, Escape to close, focus
// restored to the trigger on close.

import { useEffect, useMemo, useRef, useState } from 'react';

import { Icon } from './icons';

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon?: string;
  keywords?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) =>
      `${a.label} ${a.hint ?? ''} ${a.keywords ?? ''}`.toLowerCase().includes(q),
    );
  }, [query, actions]);

  // Reset + capture the trigger + focus the input whenever the palette opens.
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    setQuery('');
    setActive(0);
    // Focus after paint so the input exists.
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  // Keep the active index in range as the filter narrows.
  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  function close() {
    onClose();
    const t = returnFocusRef.current;
    if (t && typeof t.focus === 'function') t.focus();
  }

  function run(action: PaletteAction | undefined) {
    if (!action) return;
    // Restore focus to the trigger BEFORE running (the action may itself move
    // focus, e.g. open a project); mirrors close()'s restore.
    close();
    action.run();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (filtered.length ? (i + 1) % filtered.length : 0));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      run(filtered[active]);
      return;
    }
    if (e.key === 'Tab') {
      // Focus trap — keep Tab inside the dialog.
      const root = dialogRef.current;
      if (!root) return;
      const f = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button, [href], input, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((n) => !(n as HTMLButtonElement).disabled && n.offsetParent !== null);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center px-4 pt-[14vh]"
      style={{ background: 'var(--overlay)', backdropFilter: 'blur(2px)' }}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-xl border border-soft bg-surface shadow-2xl"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2.5 border-b border-soft px-3.5 py-3">
          <Icon name="search" size={16} className="text-fg-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command…"
            aria-label="Filter commands"
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-transparent font-mono text-sm text-fg outline-none placeholder:text-fg-faint"
          />
          <kbd className="rounded border border-soft px-1.5 py-0.5 font-mono text-[10px] text-fg-faint">
            esc
          </kbd>
        </div>
        <ul role="listbox" aria-label="Commands" className="max-h-[46vh] overflow-auto p-1.5">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center font-mono text-xs text-fg-faint">
              No matching commands
            </li>
          ) : (
            filtered.map((a, i) => (
              <li key={a.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(a)}
                  className={
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ' +
                    (i === active ? 'bg-raised' : 'hover:bg-raised/60')
                  }
                >
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md border border-soft text-fg-muted">
                    <Icon name={a.icon ?? 'arrow'} size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{a.label}</span>
                    {a.hint && (
                      <span className="block truncate font-mono text-[11px] text-fg-faint">
                        {a.hint}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
