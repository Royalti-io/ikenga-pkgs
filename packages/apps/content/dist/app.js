// Content root — bridge → mount <ContentView/>.
//
// No-build srcdoc iframe pkg. CSS rides the script path (not <link>/@import)
// because WebKitGTK cannot load subresources from the about:srcdoc the shell
// mounts. Theme is mirrored from the parent shell <html> attributes — never
// from the AppBridge host-context-changed envelope (which clobbers data-theme
// and misses system/tint/workspace flips — see [[reference_pkg_theme_reactivity]]).
//
// Plans ref: plans/atelier-design-system/08-pkg-retrofit-recipe.md (8-step recipe)
//            plans/atelier-design-system/parts/screens/content.md §§1–4
// WP-21b: builds Pipeline (kanban default + list toggle) / Calendar / Published views;
//         owns 0047 migration (content_pieces, content_published, content_stage_transitions).

import {
  html,
  useState,
  useEffect,
  createRoot,
  QueryClient,
  QueryClientProvider,
} from './lib/ui.js';
import { connectBridge, isStandalone } from './lib/bridge.js';
import { ContentView } from './features/content/content-view.js';
import tokensCss from './lib/tokens-css.js';
import appKitCss from './lib/app-kit-css.js';
import contentCss from './lib/content-css.js';

// ─── CSS injection ────────────────────────────────────────────────────────────
// Inject order: tokens → app-kit → content residue. <link>/@import fail inside
// the shell's about:srcdoc (WebKitGTK subresource bug); CSS rides the script
// path as JS strings and is injected as inline <style> (style-src 'unsafe-inline').

function injectCss(id, css) {
  if (document.querySelector(`style[${id}]`)) return;
  const el = document.createElement('style');
  el.setAttribute(id, '');
  el.textContent = css;
  document.head.appendChild(el);
}

injectCss('data-tokens-css', tokensCss);
injectCss('data-app-kit-css', appKitCss);
injectCss('data-content-css', contentCss);

// ─── Theme mirror (verbatim from tasks/dist/app.js — step 4 of the recipe) ──
// Mirror the four shell <html> attrs (data-theme/data-mode/data-density/
// data-workspace) off window.parent.document.documentElement via a
// MutationObserver (same-origin srcdoc). Standalone → prefers-color-scheme + Theme A.
// NEVER use the AppBridge host-context-changed envelope for theme — it clobbers
// data-theme to light/dark and only fires on `mode` changes, never workspace
// theme/tint/system-OS flips. data-workspace="studio" = warm terracotta-red tint
// for Content (studio tint per the screen doc §2).
const APPEARANCE_ATTRS = ['data-theme', 'data-mode', 'data-density', 'data-workspace'];
const root = document.documentElement;

function readShellAppearance() {
  try {
    if (window.parent === window) return null;
    const pr = window.parent.document.documentElement;
    const mode = pr.getAttribute('data-mode');
    if (mode !== 'light' && mode !== 'dark') return null;
    return {
      'data-theme': pr.getAttribute('data-theme') || 'A',
      'data-mode': mode,
      'data-density': pr.getAttribute('data-density') || 'comfortable',
      'data-workspace': pr.getAttribute('data-workspace') || 'app',
    };
  } catch {
    return null; // cross-origin standalone embed — caller falls back to OS
  }
}

function applyAppearance(attrs) {
  for (const k of APPEARANCE_ATTRS) {
    if (attrs[k] != null) root.setAttribute(k, attrs[k]);
  }
}

function setupTheme() {
  const fromShell = readShellAppearance();
  if (fromShell) {
    applyAppearance(fromShell);
    try {
      const target = window.parent.document.documentElement;
      const obs = new MutationObserver(() => {
        const next = readShellAppearance();
        if (next) applyAppearance(next);
      });
      obs.observe(target, { attributes: true, attributeFilter: APPEARANCE_ATTRS });
    } catch {
      /* best-effort; the static apply above already themed the document */
    }
  } else {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const applyOs = () =>
      applyAppearance({
        'data-theme': 'A',
        'data-mode': mql.matches ? 'dark' : 'light',
        'data-density': 'comfortable',
        'data-workspace': 'studio',
      });
    applyOs();
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', applyOs);
    else if (typeof mql.addListener === 'function') mql.addListener(applyOs);
  }
}
// Run synchronously at module eval (before React mounts) → themed first paint.
// Pre-set data-workspace="studio" so the studio tint renders immediately
// without a flash — overwritten at runtime by setupTheme() if shell provides it.
root.setAttribute('data-workspace', 'studio');
setupTheme();

// ─── TanStack Query ───────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

// ─── App root ─────────────────────────────────────────────────────────────────

function App() {
  const [bridgeReady, setBridgeReady] = useState(false);
  const [bridgeError, setBridgeError] = useState(null);
  const [activeFeature, setActiveFeature] = useState(null);

  useEffect(() => {
    if (isStandalone()) {
      setBridgeReady(true);
      return;
    }
    connectBridge({
      name: 'Content',
      version: '0.1.0',
      onContextChange: (ctx) => {
        const af = ctx?.royaltiSuite?.activeFeature;
        if (typeof af === 'string') setActiveFeature(af);
      },
    })
      .then((ctx) => {
        const af = ctx?.royaltiSuite?.activeFeature;
        if (typeof af === 'string') setActiveFeature(af);
        setBridgeReady(true);
      })
      .catch((e) => setBridgeError(e.message ?? String(e)));
  }, []);

  if (bridgeError) {
    return html`<div style=${{ padding: '2rem', color: 'var(--danger)' }}>Bridge error: ${bridgeError}</div>`;
  }
  if (!bridgeReady) {
    return html`<div style=${{ padding: '2rem', color: 'var(--fg-muted)' }}>Connecting…</div>`;
  }

  return html`<${QueryClientProvider} client=${queryClient}><${ContentView} activeFeature=${activeFeature} /></${QueryClientProvider}>`;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);
