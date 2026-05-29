// Agent Ops root — bridge → mount <ScheduleView/>.
//
// Single-feature app (Schedule view as the primary; Runs/Failures/Live are
// WP-11/WP-13 placeholders). All data flows through the host bridge
// (host.dbQuery reads pa.db cron_job_runs + agent_runs) — there is no
// supabase-js client. WP-07 renders FIXTURE from view-model.js.

import {
  html,
  useState,
  useEffect,
  createRoot,
  QueryClient,
  QueryClientProvider,
} from './lib/ui.js';
import { connectBridge, isStandalone } from './lib/bridge.js';
import { ScheduleView } from './features/schedule/schedule-view.js';
import tokensCss from './lib/tokens-css.js';
import agentOpsCss from './lib/agent-ops-css.js';
import agentOpsRunsCss from './lib/agent-ops-runs-css.js';
import agentOpsFormCss from './lib/agent-ops-form-css.js';

// Styling, the no-build way. A <link>/fetch to a .css fails inside the shell's
// about:srcdoc iframe (WebKitGTK subresource bug — see index.html), so CSS
// rides the script path as JS strings and is injected as inline <style>
// (style-src 'unsafe-inline' permits it). Order matters: tokens first (they
// define --fg/--bg-base/--space-*/etc.), then agent-ops-css.js which consumes them.
function injectCss(id, css) {
  if (document.querySelector(`style[${id}]`)) return;
  const el = document.createElement('style');
  el.setAttribute(id, '');
  el.textContent = css;
  document.head.appendChild(el);
}

// Token aliases for names agent-ops-css.js references that @ikenga/tokens
// doesn't expose at the top level — map each to its canonical token.
// These are theme-AGNOSTIC: they ride whatever [data-theme][data-mode] palette
// the bundled tokens.css resolves, so they track the shell's theme automatically.
const aliasCss = `
:root {
  --fg-faint:      var(--fg-subtle);
  --systemic:      var(--success);
  --systemic-soft: color-mix(in srgb, var(--success) 14%, transparent);
  --achievement:   var(--warning);
  --achievement-soft: color-mix(in srgb, var(--warning) 14%, transparent);
  --motion-fast:   120ms;
  --ease-calm:     ease;
}`;
injectCss('data-tokens-css', tokensCss);
injectCss('data-token-aliases', aliasCss);
injectCss('data-agent-ops-css', agentOpsCss);
injectCss('data-agent-ops-runs-css', agentOpsRunsCss);
injectCss('data-agent-ops-form-css', agentOpsFormCss);

// Theme — own it directly by mirroring the shell's <html> attributes, NOT via
// the AppBridge host-context push (which was unreliable: it clobbered our
// data-theme to light/dark and only fired on `mode` changes, never workspace
// theme / tint / system-OS flips). The pkg iframe is same-origin with the shell
// (srcdoc + sandbox allow-same-origin), so we read data-theme/data-mode/
// data-density/data-workspace off the parent <html> (the shell writes them) and
// copy them onto ours. @ikenga/tokens is keyed on exactly these attributes, so
// the bundled palette then matches the shell exactly across A/B/C × light/dark.
// A MutationObserver on the parent re-mirrors on every switch. Standalone
// (parent not same-origin-readable) we follow prefers-color-scheme with palette A.
// This is the proven artifact pattern — see shell/src/lib/artifact/bridge.ts setupTheme().
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

// The shell side-menu is published + maintained by ScheduleView (it folds in
// the live view + active-filter state and toggles the filter rows' `disabled`
// flag when a non-schedule view is active). See
// `buildAgentOpsMenu` / the publish effect in features/schedule/schedule-view.js.

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

  useEffect(() => {
    if (isStandalone()) {
      // Standalone dev — no parent shell, so no host bridge and no data
      // backend. The view still mounts (themed first paint); data queries will
      // use FIXTURE (no bridge needed in WP-07). Mount the pkg inside the
      // shell for live pa.db data (WP-08).
      setBridgeReady(true);
      return;
    }
    // Bridge carries dispatch + activeFeature only — theme is handled by the
    // parent-<html> mirror above, and data flows through host.dbQuery.
    connectBridge({
      name: 'Agent Ops',
      version: '0.1.0',
      onContextChange: (ctx) => {
        const af = ctx?.royaltiSuite?.activeFeature;
        if (typeof af === 'string') setActiveFeature(af);
      },
    })
      .then((ctx) => {
        const af = ctx?.royaltiSuite?.activeFeature;
        if (typeof af === 'string') setActiveFeature(af);
        // The side menu is published by ScheduleView once it mounts (it owns the
        // view + filter state the menu reflects). No initial setMenu here.
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

  return html`<${QueryClientProvider} client=${queryClient}><${ScheduleView} activeFeature=${activeFeature} bridgeReady=${bridgeReady} /></${QueryClientProvider}>`;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);
