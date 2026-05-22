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
import { connectBridge, isStandalone } from './studio/bridge';
import './studio/styles/index.css';

function ScaffoldPlaceholder({ mode }: { mode: 'standalone' | 'connecting' | 'error' }) {
  return (
    <main className="studio-scaffold">
      <h1 className="studio-scaffold__title">Studio</h1>
      <p className="studio-scaffold__hint">
        {mode === 'error'
          ? 'Could not connect to the host — see devtools.'
          : 'Connecting to the workspace…'}
      </p>
      <p className="studio-scaffold__mode" data-mode={mode === 'error' ? 'connecting' : mode}>
        bridge: {mode}
      </p>
    </main>
  );
}

const host = document.getElementById('root');
if (!host) {
  throw new Error('com.ikenga.studio: #root not found in iframe document');
}

const root: Root = createRoot(host);
root.render(
  <StrictMode>
    <ScaffoldPlaceholder mode={isStandalone() ? 'standalone' : 'connecting'} />
  </StrictMode>,
);

connectBridge()
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[studio] connectBridge() failed', err);
    root.render(
      <StrictMode>
        <ScaffoldPlaceholder mode="error" />
      </StrictMode>,
    );
  });
