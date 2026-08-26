// com.ikenga.git UI root — WP-02 scaffold stub.
//
// Mirrors the theme-mirroring pattern used by com.ikenga.tasks (own theme by
// reading the parent <html>'s data-theme/data-mode/data-density, since the
// iframe is same-origin with the shell — srcdoc + sandbox allow-same-origin —
// rather than via the AppBridge host-context push, which is unreliable for
// this). No bridge connect / RPC calls yet: WP-06 replaces this file with the
// real side-menu shell (Changes · History · Branches · Worktrees · PRs) wired
// to host.pkgSidecarCall against the WP-04 sidecar.

function mirrorTheme() {
  try {
    const parentHtml = window.parent?.document?.documentElement;
    if (!parentHtml) return;
    const html = document.documentElement;
    for (const attr of ['data-theme', 'data-mode', 'data-density', 'data-workspace']) {
      const v = parentHtml.getAttribute(attr);
      if (v) html.setAttribute(attr, v);
      else html.removeAttribute(attr);
    }
  } catch {
    // Standalone (no same-origin parent) — fall back to prefers-color-scheme
    // via the CSS `color-scheme: light dark` already set in index.html.
  }
}

mirrorTheme();

try {
  const observer = new MutationObserver(mirrorTheme);
  observer.observe(window.parent.document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-mode', 'data-density', 'data-workspace'],
  });
} catch {
  // Standalone — nothing to observe.
}
