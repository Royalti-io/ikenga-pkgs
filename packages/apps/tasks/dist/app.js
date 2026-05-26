// Tasks root — bridge → supabase → mount <TasksView/>.
//
// Single-feature app (unlike Suite, no feature registry / sidebar router). The
// source main.tsx mounts TasksView directly inside a QueryClientProvider; we
// mirror that. Standalone mode reads Supabase keys from the query string so the
// pkg is previewable outside the shell.

import {
  html,
  useState,
  useEffect,
  createRoot,
  QueryClient,
  QueryClientProvider,
} from './lib/ui.js';
import { connectBridge, isStandalone, setMenu } from './lib/bridge.js';
import { setSupabaseConfig, hasSupabase } from './lib/supabase.js';
import { TasksView } from './features/tasks/tasks-view.js';
import tokensCss from './lib/tokens-css.js';
import tasksCss from './lib/tasks-css.js';

// Styling, the no-build way. A <link>/fetch to a .css fails inside the shell's
// about:srcdoc iframe (WebKitGTK subresource bug — see index.html), so CSS
// rides the script path as JS strings and is injected as inline <style>
// (style-src 'unsafe-inline' permits it). Order matters: tokens first (they
// define --fg/--bg-base/--space-*/etc.), then tasks.css which consumes them.
function injectCss(id, css) {
  if (document.querySelector(`style[${id}]`)) return;
  const el = document.createElement('style');
  el.setAttribute(id, '');
  el.textContent = css;
  document.head.appendChild(el);
}
// Legacy token aliases. tasks.css (ported from the source app) uses a handful
// of token names @ikenga/tokens doesn't expose — map each to its canonical
// bundled token. These are theme-AGNOSTIC (no --color-* host slots, no literal
// fallbacks): they ride whatever [data-theme][data-mode] palette the bundled
// tokens.css resolves, so they track the shell's theme automatically once the
// mirror below sets the matching attributes. (--mail-fg, --tab-h, --radius-pill
// keep their inline fallbacks in tasks.css and aren't aliased here.)
const aliasCss = `
:root {
  --live:             var(--success);
  --live-soft:        color-mix(in srgb, var(--success) 14%, transparent);
  --agent-soft:       color-mix(in srgb, var(--agent) 14%, transparent);
  --achievement-soft: color-mix(in srgb, var(--achievement) 14%, transparent);
  --fg-faint:         var(--fg-subtle);
  --text-body-sm:     var(--text-body);
  --text-h4:          var(--text-h3);
  --font-body:        var(--font-sans);
  --motion-fast:      120ms;
  --ease-calm:        ease;
}`;
injectCss('data-tokens-css', tokensCss);
injectCss('data-token-aliases', aliasCss);
injectCss('data-tasks-css', tasksCss);

// Theme — own it directly by mirroring the shell's <html> attributes, NOT via
// the AppBridge host-context push (which was unreliable: it clobbered our
// data-theme to light/dark and only fired on `mode` changes, never workspace
// theme / tint / system-OS flips). The pkg iframe is same-origin with the shell
// (srcdoc + sandbox allow-same-origin), so we read data-theme/data-mode/
// data-density/data-workspace off the parent <html> (the shell writes them — see
// shell/src/lib/ikenga/theme-store.ts) and copy them onto ours. @ikenga/tokens
// is keyed on exactly these attributes, so the bundled palette then matches the
// shell exactly across A/B/C × light/dark. A MutationObserver on the parent
// re-mirrors on every switch. Standalone (parent not same-origin-readable) we
// follow prefers-color-scheme with palette A. This is the proven artifact
// pattern — see shell/src/lib/artifact/bridge.ts setupTheme().
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
        'data-workspace': 'app',
      });
    applyOs();
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', applyOs);
    else if (typeof mql.addListener === 'function') mql.addListener(applyOs);
  }
}
// Run synchronously at module eval (before React mounts) → themed first paint.
setupTheme();

// Shell side-menu (PkgMode renders it when this pkg's pane is focused). Views
// switch the mounted view; `f:*` filter items jump the list to a group. Clicks
// return via hostContext.royaltiSuite.activeFeature → handled in TasksView.
const MENU_ITEMS = [
  { id: 'tasks', label: 'Tasks', icon: 'list-checks' },
  { id: 'agenda', label: 'Agenda', icon: 'calendar-days' },
  { id: 'triage', label: 'Triage', icon: 'activity' },
  { id: 'f:today', label: 'Today', icon: 'sun' },
  { id: 'f:overdue', label: 'Overdue', icon: 'alert-triangle' },
  { id: 'f:autoclosed', label: 'Auto-closed', icon: 'check-check' },
];

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  const [bridgeReady, setBridgeReady] = useState(false);
  const [bridgeError, setBridgeError] = useState(null);
  // Active side-menu item (shell PkgMode → hostContext.royaltiSuite.activeFeature).
  const [activeFeature, setActiveFeature] = useState(null);
  // Bump to force a re-render once Supabase config lands (so hasSupabase()
  // flips from false → true and the view mounts).
  const [, setSbTick] = useState(0);
  const bumpSb = () => setSbTick((n) => n + 1);

  useEffect(() => {
    if (isStandalone()) {
      // Standalone dev — read keys from query string for quick iteration:
      // ?url=https://xxx.supabase.co&anon_key=eyJ...
      const params = new URLSearchParams(location.search);
      const url = params.get('url');
      const anonKey = params.get('anon_key');
      if (url && anonKey) {
        setSupabaseConfig({ url, anonKey });
        bumpSb();
      }
      setBridgeReady(true);
      return;
    }
    // Bridge is for Supabase config + dispatch only — theme is handled by the
    // parent-<html> mirror above, independent of the AppBridge context.
    connectBridge({
      name: 'Tasks',
      version: '0.2.0',
      onContextChange: (ctx) => {
        if (ctx?.supabase) {
          setSupabaseConfig(ctx.supabase);
          bumpSb();
        }
        const af = ctx?.royaltiSuite?.activeFeature;
        if (typeof af === 'string') setActiveFeature(af);
      },
    })
      .then((ctx) => {
        if (ctx?.supabase) {
          setSupabaseConfig(ctx.supabase);
          bumpSb();
        }
        const af = ctx?.royaltiSuite?.activeFeature;
        if (typeof af === 'string') setActiveFeature(af);
        // Publish the side menu; the shell renders it in the left panel and
        // echoes clicks back via royaltiSuite.activeFeature (handled above).
        setMenu(MENU_ITEMS).catch((e) => console.warn('[tasks] setMenu failed', e));
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
  if (!hasSupabase()) {
    return html`
      <div style=${{ padding: '2rem', color: 'var(--fg-muted)' }}>
        <p>Supabase not configured.</p>
        <p>In standalone mode, pass <code>?url=…&amp;anon_key=…</code>. Inside the shell, ensure the vault has Supabase keys.</p>
      </div>
    `;
  }

  return html`<${QueryClientProvider} client=${queryClient}><${TasksView} activeFeature=${activeFeature} /></${QueryClientProvider}>`;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);
