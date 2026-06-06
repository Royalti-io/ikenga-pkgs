// Mail root — bridge → mount <MailView/>.
//
// No-build srcdoc iframe pkg. CSS rides the script path (not <link>/@import)
// because WebKitGTK cannot load subresources from the about:srcdoc the shell
// mounts. Theme is mirrored from the parent shell <html> attributes — never
// from the AppBridge host-context-changed envelope (which clobbers data-theme
// and misses system/tint/workspace flips — see [[reference_pkg_theme_reactivity]]).

import {
  html,
  useState,
  useEffect,
  createRoot,
  QueryClient,
  QueryClientProvider,
} from './lib/ui.js';
import { connectBridge, isStandalone } from './lib/bridge.js';
import { MailView } from './features/mail/mail-view.js';
import tokensCss from './lib/tokens-css.js';
import appKitCss from './lib/app-kit-css.js';
import mailCss from './lib/mail-css.js';

// ─── CSS injection ────────────────────────────────────────────────────────────
// Inject order: tokens → app-kit → mail residue. <link>/@import fail inside
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
injectCss('data-mail-css', mailCss);

// ─── Theme mirror (verbatim from tasks/dist/app.js) ──────────────────────────
// Mirror the four shell <html> attrs (data-theme/data-mode/data-density/
// data-workspace) off window.parent.document.documentElement via a
// MutationObserver (same-origin srcdoc). Standalone (parent not same-origin-
// readable) → prefers-color-scheme + Theme A. This is the proven artifact
// pattern — see shell/src/lib/artifact/bridge.ts setupTheme().
// NEVER use the AppBridge host-context-changed envelope for theme — it clobbers
// data-theme to light/dark and only fires on `mode` changes, never workspace
// theme/tint/system-OS flips.
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
        'data-workspace': 'mail',
      });
    applyOs();
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', applyOs);
    else if (typeof mql.addListener === 'function') mql.addListener(applyOs);
  }
}
// Run synchronously at module eval (before React mounts) → themed first paint.
// Set data-workspace="mail" so --tint-mail-bg / --tint-mail-fg resolve correctly.
root.setAttribute('data-workspace', 'mail');
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
      name: 'Mail',
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

  return html`<${QueryClientProvider} client=${queryClient}><${MailView} activeFeature=${activeFeature} /></${QueryClientProvider}>`;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);
