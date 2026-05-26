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
import { connectBridge, isStandalone } from './lib/bridge.js';
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
// Host-bridge: tasks.css consumes shorthand token names (--bg-base/--fg/--border/
// --primary/--font-body), but tokens.css defines those as STATIC per-theme literals
// and never references the host's live slots. The shell ships the live theme as the
// curated --color-*/--font-* set (MCP_UI_APPS_TOKEN_KEYS; bridge.js applies them to
// :root). This layer maps shorthand ← live slot (static literal as fallback) so the
// pkg tracks the user's actual theme/mode/workspace instead of our bundled guess.
// Injected AFTER tokens.css so it wins the specificity tie (:root[data-mode], later).
// Fallbacks are the canonical Dusk-Wood-A dark literals (= what the shell ships
// for its default theme), so colors match even before the bridge connects or in
// standalone preview. When the host has pushed live --color-* (inline style, top
// priority), those win → the pkg tracks the user's actual theme/mode.
const PJS = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";
const hostBridgeCss = `
:root[data-mode] {
  --bg-base:    var(--color-background-primary,   hsl(28,18%,4%));
  --bg-surface: var(--color-background-secondary, hsl(28,14%,7%));
  --bg-raised:  var(--color-background-tertiary,  hsl(28,11%,11%));
  --fg:         var(--color-text-primary,         hsl(36,28%,90%));
  --fg-muted:   var(--color-text-secondary,       hsl(32,11%,56%));
  --fg-faint:   var(--color-text-tertiary,        hsl(28,9%,36%));
  --border:      var(--color-border-primary,   hsl(28,14%,15%));
  --border-soft: var(--color-border-secondary, hsl(28,14%,11%));
  --primary:     var(--color-ring-primary,     hsl(20,50%,34%));
  --danger:      var(--color-text-danger,      hsl(8,68%,46%));
  --font-body:    var(--font-sans, ${PJS});
  --font-display: var(--font-sans, ${PJS});
}`;
injectCss('data-tokens-css', tokensCss);
injectCss('data-host-bridge-css', hostBridgeCss);
injectCss('data-tasks-css', tasksCss);

// tokens.css scopes its color slots under :root[data-mode] / [data-theme].
// Without these attributes the vars never resolve (→ unstyled). Default to the
// shell's canonical Theme A (Dusk Wood) dark; the bridge updates data-mode from
// the live host theme below.
const root = document.documentElement;
if (!root.dataset.theme) root.dataset.theme = 'A';
if (!root.dataset.mode) root.dataset.mode = 'dark';
function applyMode(theme) {
  root.dataset.mode = theme === 'light' ? 'light' : 'dark';
}

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
    connectBridge({
      name: 'Tasks',
      version: '0.2.0',
      onContextChange: (ctx) => {
        if (ctx?.theme) applyMode(ctx.theme);
        if (ctx?.supabase) {
          setSupabaseConfig(ctx.supabase);
          bumpSb();
        }
      },
    })
      .then((ctx) => {
        if (ctx?.theme) applyMode(ctx.theme);
        if (ctx?.supabase) {
          setSupabaseConfig(ctx.supabase);
          bumpSb();
        }
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

  return html`<${QueryClientProvider} client=${queryClient}><${TasksView} /></${QueryClientProvider}>`;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);
