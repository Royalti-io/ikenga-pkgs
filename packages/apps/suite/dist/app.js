// Suite root — bridge → supabase → shell-driven feature router.
//
// The shell's left sidebar (PkgMode) renders our feature menu and tells us
// which one is active via hostContext.royaltiSuite.activeFeature. We mount
// only the active feature's Component. Standalone-mode falls back to an
// internal sidebar so the pkg is usable outside the shell.

import { html, useState, useEffect, createRoot } from './lib/ui.js';
import { connectBridge, setMenu, isStandalone } from './lib/bridge.js';
import { setSupabaseConfig, hasSupabase } from './lib/supabase.js';
import { FEATURES, findFeature } from './features/_registry.js';
import { isFeatureEnabled, subscribeSettings } from './lib/settings.js';

function App() {
  const [bridgeReady, setBridgeReady] = useState(false);
  const [bridgeError, setBridgeError] = useState(null);
  // Active feature ID — in shell mode, this comes from hostContext.
  // In standalone mode, we manage it locally via #/<id> hash.
  const [activeFeature, setActiveFeature] = useState(null);
  const [, setSettingsTick] = useState(0);

  useEffect(() => subscribeSettings(() => setSettingsTick((n) => n + 1)), []);

  // Standalone hashchange listener — only meaningful when we're not embedded.
  useEffect(() => {
    if (!isStandalone()) return;
    const handler = () => {
      const raw = (location.hash || '').replace(/^#\/?/, '');
      if (raw) setActiveFeature(raw);
    };
    window.addEventListener('hashchange', handler);
    handler();
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  useEffect(() => {
    if (isStandalone()) {
      // Standalone dev — read keys from query string for quick iteration:
      // ?url=https://xxx.supabase.co&anon_key=eyJ...
      const params = new URLSearchParams(location.search);
      const url = params.get('url');
      const anonKey = params.get('anon_key');
      if (url && anonKey) setSupabaseConfig({ url, anonKey });
      // Default to first enabled feature.
      const first = FEATURES.find((f) => isFeatureEnabled(f.id));
      if (first && !activeFeature) setActiveFeature(first.id);
      setBridgeReady(true);
      return;
    }
    connectBridge({
      name: 'Suite',
      version: '0.1.0',
      onContextChange: (ctx) => {
        if (ctx?.supabase) setSupabaseConfig(ctx.supabase);
        // Shell sidebar click → re-emitted hostContext with new active feature.
        const af = ctx?.royaltiSuite?.activeFeature;
        if (typeof af === 'string') setActiveFeature(af);
      },
    })
      .then((ctx) => {
        if (ctx?.supabase) setSupabaseConfig(ctx.supabase);
        const af = ctx?.royaltiSuite?.activeFeature;
        if (typeof af === 'string') setActiveFeature(af);
        // Publish our menu to the shell. The shell renders this in its left
        // sidebar; clicks come back via hostContext.royaltiSuite.activeFeature.
        const items = FEATURES
          .filter((f) => isFeatureEnabled(f.id))
          .map((f) => ({ id: f.id, label: f.label, icon: f.icon }));
        setMenu(items).catch((e) => console.warn('[suite] setMenu failed', e));
        setBridgeReady(true);
      })
      .catch((e) => setBridgeError(e.message ?? String(e)));
  }, []);

  if (bridgeError) {
    return html`<div style=${{ padding: '2rem', color: 'var(--suite-danger)' }}>Bridge error: ${bridgeError}</div>`;
  }
  if (!bridgeReady) {
    return html`<div style=${{ padding: '2rem', color: 'var(--suite-muted)' }}>Connecting…</div>`;
  }

  const enabledFeatures = FEATURES.filter((f) => isFeatureEnabled(f.id));
  const target = activeFeature ? findFeature(activeFeature) : null;
  const resolved = target && isFeatureEnabled(target.id) ? target : enabledFeatures[0];

  let content;
  if (!resolved) {
    content = html`<div style=${{ padding: '2rem' }}>No features enabled.</div>`;
  } else if (!hasSupabase()) {
    content = html`
      <div style=${{ padding: '2rem', color: 'var(--suite-muted)' }}>
        <p>Supabase not configured.</p>
        <p>In standalone mode, pass <code>?url=…&amp;anon_key=…</code>. Inside the shell, ensure the vault has Supabase keys.</p>
      </div>
    `;
  } else {
    content = html`<${resolved.Component} />`;
  }

  // Embedded: no internal sidebar — the shell renders our menu in the left
  // panel via PkgMode. Standalone: render a minimal fallback nav so the
  // pkg is usable outside the shell.
  if (isStandalone()) {
    return html`
      <div class="layout">
        <nav class="standalone-nav">
          <div class="brand">Suite (standalone)</div>
          ${enabledFeatures.map((f) => html`
            <button
              key=${f.id}
              class=${resolved?.id === f.id ? 'active' : ''}
              onClick=${() => { location.hash = `#/${f.id}`; }}
            >${f.label}</button>
          `)}
        </nav>
        <main class="content">${content}</main>
        <style>${LAYOUT_CSS}</style>
      </div>
    `;
  }

  return html`
    <main class="content content-embedded">${content}</main>
    <style>${LAYOUT_CSS}</style>
  `;
}

const LAYOUT_CSS = `
  .layout { display: grid; grid-template-columns: 200px 1fr; min-height: 100vh; }
  .standalone-nav { border-right: 1px solid var(--suite-border); padding: 1rem 0.5rem; display: flex; flex-direction: column; gap: 0.15rem; }
  .standalone-nav .brand { padding: 0.5rem 0.75rem 1rem; font-weight: 600; font-size: 0.95rem; }
  .standalone-nav button { display: flex; align-items: center; gap: 0.5rem; width: 100%; padding: 0.5rem 0.75rem; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; border-radius: 6px; text-align: left; }
  .standalone-nav button:hover { background: var(--suite-hover); }
  .standalone-nav button.active { background: var(--suite-hover); font-weight: 500; }
  .content { overflow: auto; min-height: 100vh; }
  .content-embedded { padding: 0; }
`;

createRoot(document.getElementById('root')).render(html`<${App} />`);
