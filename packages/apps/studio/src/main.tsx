// Boot for com.ikenga.studio.
//
// Mounts a connecting-state placeholder immediately, fires the host-bridge
// handshake, then swaps in <App /> once it resolves (in either shell or
// standalone mode — both are valid; standalone just means mock MCP + no
// Supabase). On a hard bridge failure the placeholder stays up with the
// failure logged to devtools. The no-open-project launcher pre-empt lands
// inside <App /> in commit 11; until then <App /> boots straight into the
// pane layout.

import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { App } from './studio/App';
import { connectBridge } from './studio/bridge';
import { setupTheme } from './studio/theme';
import './studio/styles/index.css';

// Own the theme BEFORE React mounts (and before the styles above paint anything
// theme-dependent): mirror the shell's data-theme/mode/density onto our own
// <html>, or pin Theme A + OS scheme standalone. This is the retired
// AppBridge-theme-leg's replacement — see theme.ts.
setupTheme();

// Boot placeholder connection state. Pre-settled is always the neutral
// "connecting" state (never an error): the first-mount error flash came from
// surfacing an error-ish state before the handshake resolved. We only show the
// failure copy after connectBridge() actually REJECTS, or a grace timeout
// passes with no connection — and standalone resolves near-instantly, so it
// never trips the timeout.
type BootState = 'connecting' | 'error';

function ScaffoldPlaceholder({ state }: { state: BootState }) {
  return (
    <main className="studio-scaffold">
      <h1 className="studio-scaffold__title">Studio</h1>
      <p className="studio-scaffold__hint">
        {state === 'error'
          ? "Studio couldn't reach the workspace."
          : 'Connecting to your workspace…'}
      </p>
    </main>
  );
}

const host = document.getElementById('root');
if (!host) {
  throw new Error('com.ikenga.studio: #root not found in iframe document');
}

const root: Root = createRoot(host);

function renderBoot(state: BootState): void {
  root.render(
    <StrictMode>
      <ScaffoldPlaceholder state={state} />
    </StrictMode>,
  );
}

// Neutral connecting state until the handshake settles — no error surfaced yet.
renderBoot('connecting');

let settled = false;
// Grace timeout: only escalate to the error copy if nothing has connected after
// ~1.5s. A resolved OR rejected connectBridge() clears this first.
const graceTimer = window.setTimeout(() => {
  if (!settled) renderBoot('error');
}, 1500);

connectBridge()
  .then(() => {
    settled = true;
    window.clearTimeout(graceTimer);
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((err) => {
    settled = true;
    window.clearTimeout(graceTimer);
    // eslint-disable-next-line no-console
    console.error('[studio] connectBridge() failed', err);
    renderBoot('error');
  });
