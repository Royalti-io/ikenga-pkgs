// com.ikenga.studio · theme ownership (parent-mirror)
//
// Studio OWNS its own theme, the same way 9/11 app pkgs do. The shell
// srcdoc-inlines this pane into an iframe that is SAME-ORIGIN with the shell
// chrome, so we can read the live `data-theme` / `data-mode` / `data-density`
// / `data-workspace` attributes the shell writes on its own `<html>` and mirror
// them onto this document's `<html>`. `@ikenga/tokens` is imported into the
// bundle (styles/index.css), so its `[data-theme="A"][data-mode="dark"]`
// selectors resolve the moment the attributes land — Dusk Wood, warm-dark, gold
// achievement chips. A `MutationObserver` on the PARENT root re-mirrors on every
// live theme/mode/density flip.
//
// This REPLACES the retired AppBridge theme leg (`applyDocumentTheme` /
// `applyHostStyleVariables` / `applyHostFonts`), which wrote `data-theme=
// 'light'|'dark'` and actively clobbered the palette — the root-cause bug this
// wave fixes. Runs at module-eval BEFORE React mounts (see main.tsx) so the
// first paint is already themed.
//
// Standalone (`pnpm dev`, no readable parent): pin Theme A + follow the OS
// `prefers-color-scheme` (dark default). This is why a headless standalone
// capture now resolves warm-dark instead of the cool hsl-220 base.

const MIRRORED_ATTRS = ['data-theme', 'data-mode', 'data-density', 'data-workspace'] as const;

/** The parent `<html>`, or null when there's no same-origin-readable parent
 *  (standalone dev, or a cross-origin embed). */
function readableParentRoot(): HTMLElement | null {
  try {
    if (typeof window === 'undefined' || window.parent === window) return null;
    // Touching parent.document throws synchronously on a cross-origin parent.
    return window.parent.document.documentElement;
  } catch {
    return null;
  }
}

/** Copy the four theme attributes from `src` onto this document's root. */
function mirror(src: HTMLElement): void {
  const dst = document.documentElement;
  for (const attr of MIRRORED_ATTRS) {
    const val = src.getAttribute(attr);
    if (val === null) dst.removeAttribute(attr);
    else dst.setAttribute(attr, val);
  }
}

/** Standalone: pin Theme A and track the OS color scheme (dark default). */
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
  } else if (typeof mql.addListener === 'function') {
    // Safari < 14.
    mql.addListener(apply);
  }
}

/** Install theme ownership. Call once at module-eval before React mounts. */
export function setupTheme(): void {
  const parentRoot = readableParentRoot();
  if (!parentRoot) {
    setupStandalone();
    return;
  }

  // Initial mirror — themed before first paint.
  mirror(parentRoot);

  // Live-switch: re-mirror whenever the shell flips theme/mode/density/workspace.
  try {
    const obs = new MutationObserver(() => mirror(parentRoot));
    obs.observe(parentRoot, {
      attributes: true,
      attributeFilter: [...MIRRORED_ATTRS],
    });
  } catch {
    // best-effort; the static mirror above already themed the document.
  }
}
