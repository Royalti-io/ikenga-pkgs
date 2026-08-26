// com.ikenga.git · theme ownership (parent-mirror)
//
// Same pattern as com.ikenga.tasks (dist/app.js) and com.ikenga.studio
// (src/studio/theme.ts, memory `reference_pkg_theme_reactivity`: 9/11 app
// pkgs). The shell srcdoc-inlines this pane same-origin with the shell
// chrome, so we read the live data-theme/data-mode/data-density/data-workspace
// attributes off the PARENT <html> and mirror them onto our own document root.
// styles.css keys its palette off those same attributes locally — the
// iframe sandbox owns its own var(--*) namespace, the shell's chrome
// stylesheet does not leak through the iframe boundary.
//
// Standalone (no readable parent — `vite dev` in a bare tab): pin Theme A and
// follow the OS prefers-color-scheme, matching every other app pkg's fallback.

const MIRRORED_ATTRS = ['data-theme', 'data-mode', 'data-density', 'data-workspace'] as const;

function readableParentRoot(): HTMLElement | null {
  try {
    if (typeof window === 'undefined' || window.parent === window) return null;
    // Touching parent.document throws synchronously on a cross-origin parent.
    return window.parent.document.documentElement;
  } catch {
    return null;
  }
}

function mirror(src: HTMLElement): void {
  const dst = document.documentElement;
  for (const attr of MIRRORED_ATTRS) {
    const val = src.getAttribute(attr);
    if (val === null) dst.removeAttribute(attr);
    else dst.setAttribute(attr, val);
  }
}

function setupStandalone(): void {
  const root = document.documentElement;
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    root.setAttribute('data-theme', 'A');
    root.setAttribute('data-mode', mql.matches ? 'dark' : 'light');
  };
  apply();
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', apply);
  } else if (typeof (mql as { addListener?: unknown }).addListener === 'function') {
    // Safari < 14.
    (mql as unknown as { addListener: (fn: () => void) => void }).addListener(apply);
  }
}

/** Install theme ownership. Call once at module-eval, before the first paint. */
export function setupTheme(): void {
  const parentRoot = readableParentRoot();
  if (!parentRoot) {
    setupStandalone();
    return;
  }

  mirror(parentRoot);

  try {
    const obs = new MutationObserver(() => mirror(parentRoot));
    obs.observe(parentRoot, {
      attributes: true,
      attributeFilter: [...MIRRORED_ATTRS],
    });
  } catch {
    // Non-fatal — the initial mirror above still applied.
  }
}
